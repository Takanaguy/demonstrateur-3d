import { createCubeGeometry } from './cube'
import { boundingBox, triangleCount, vertexCount, type Mesh } from './mesh'
import {
  MAX_RINGS,
  MAX_SEGMENTS,
  SHAPE_IDS,
  createCone,
  createPlane,
  createShape,
  createSphere,
} from './shapes'
import { cross, dot, length, subtract, type Vec3 } from './vec3'

function vertex(data: Float32Array, i: number): Vec3 {
  return [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!]
}

/**
 * Les vérifications que TOUTE forme doit satisfaire : indices valides, normales de longueur 1, et
 * chaque triangle tourné dans le sens inverse des aiguilles d'une montre vu de l'extérieur
 * (son produit vectoriel va dans le même sens que les normales de ses sommets).
 */
function expectWellFormed(mesh: Mesh) {
  const count = vertexCount(mesh)
  expect(mesh.positions.length).toBe(mesh.normals.length)
  expect(mesh.indices.length % 3).toBe(0)

  // Pas d'expect() par élément : sur une sphère de 66 000 sommets, ce serait des centaines de
  // milliers d'appels. On cherche une violation et on n'échoue qu'à la première trouvée.
  for (const index of mesh.indices) {
    if (!(index >= 0 && index < count)) throw new Error(`Indice ${index} hors de [0, ${count}).`)
  }

  for (let i = 0; i < count; i++) {
    const len = length(vertex(mesh.normals, i))
    if (!(Math.abs(len - 1) < 1e-5)) throw new Error(`La normale du sommet ${i} a pour longueur ${len}, pas 1.`)
  }

  for (let t = 0; t < triangleCount(mesh); t++) {
    const [ia, ib, ic] = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!]
    const [a, b, c] = [vertex(mesh.positions, ia), vertex(mesh.positions, ib), vertex(mesh.positions, ic)]
    const [na, nb, nc] = [vertex(mesh.normals, ia), vertex(mesh.normals, ib), vertex(mesh.normals, ic)]
    const averageNormal: Vec3 = [
      na[0] + nb[0] + nc[0],
      na[1] + nb[1] + nc[1],
      na[2] + nb[2] + nc[2],
    ]
    const faceVector = cross(subtract(b, a), subtract(c, a))
    // Strictement positif : un triangle d'aire nulle (dégénéré) serait aussi détecté ici.
    if (!(dot(faceVector, averageNormal) > 0)) {
      throw new Error(`Le triangle ${t} (${ia}, ${ib}, ${ic}) est mal orienté ou dégénéré.`)
    }
  }
}

describe.each([
  ['cube', createCubeGeometry(2), 24, 12],
  ['plan', createPlane(2), 4, 2],
  ['sphère 16x8', createSphere(16, 8), 17 * 9, 2 * 16 * 7],
  ['sphère minimale 3x2', createSphere(3, 2), 4 * 3, 2 * 3 * 1],
  ['sphère 48x24 (celle de l\'interface)', createSphere(48, 24), 49 * 25, 2 * 48 * 23],
  ['cône 16', createCone(16), 3 * 16 + 2, 2 * 16],
  ['cône minimal 3', createCone(3), 3 * 3 + 2, 2 * 3],
])('forme : %s', (_name, mesh, expectedVertices, expectedTriangles) => {
  it(`a ${expectedVertices} sommets et ${expectedTriangles} triangles`, () => {
    expect(vertexCount(mesh)).toBe(expectedVertices)
    expect(triangleCount(mesh)).toBe(expectedTriangles)
  })

  it('indices valides, normales de longueur 1, triangles en sens inverse des aiguilles d\'une montre vus de l\'extérieur', () => {
    expectWellFormed(mesh)
  })
})

describe('createPlane', () => {
  it('est un carré horizontal (plan XZ) de la taille demandée, centré sur l\'origine', () => {
    const plane = createPlane(4)

    expect(boundingBox(plane)).toEqual({ min: [-2, 0, -2], max: [2, 0, 2] })
  })

  it('a la normale +Y pour ses quatre sommets', () => {
    const { normals } = createPlane()

    for (let i = 0; i < 4; i++) expect(vertex(normals, i)).toEqual([0, 1, 0])
  })

  it.each([0, -1, NaN, Infinity])('refuse la taille %s', (size) => {
    expect(() => createPlane(size)).toThrow(RangeError)
  })
})

describe('createSphere', () => {
  const sphere = createSphere(24, 12)

  it('tous les sommets sont à distance 1 du centre', () => {
    for (let i = 0; i < vertexCount(sphere); i++) expect(length(vertex(sphere.positions, i))).toBeCloseTo(1, 5)
  })

  it('la normale d\'un sommet est sa position (normales lisses)', () => {
    for (let i = 0; i < vertexCount(sphere); i++) {
      const [p, n] = [vertex(sphere.positions, i), vertex(sphere.normals, i)]
      expect(n[0]).toBeCloseTo(p[0], 5)
      expect(n[1]).toBeCloseTo(p[1], 5)
      expect(n[2]).toBeCloseTo(p[2], 5)
    }
  })

  it('touche les deux pôles (y = +1 et y = -1) et son équateur', () => {
    const box = boundingBox(sphere)!

    expect(box.max[1]).toBeCloseTo(1, 5)
    expect(box.min[1]).toBeCloseTo(-1, 5)
    expect(box.max[0]).toBeCloseTo(1, 5)
  })

  it('aucun triangle d\'aire nulle (ceux des pôles sont omis)', () => {
    // expectWellFormed exige un produit vectoriel strictement positif, donc non nul.
    expectWellFormed(sphere)
  })

  it('à la taille maximale, passe en indices 32 bits et reste correcte', () => {
    const big = createSphere(MAX_SEGMENTS, MAX_RINGS) // 257 x 257 = 66 049 sommets > 65 535

    expect(vertexCount(big)).toBe(257 * 257)
    expect(big.indices).toBeInstanceOf(Uint32Array)
    let largest = 0
    for (const index of big.indices) largest = Math.max(largest, index)
    expect(largest).toBeGreaterThan(65_535) // sans cela, Uint16Array aurait tronqué
    expectWellFormed(big)
  })

  it('une sphère ordinaire utilise des indices 16 bits', () => {
    expect(sphere.indices).toBeInstanceOf(Uint16Array)
  })

  it.each([
    [2, 8],
    [3.5, 8],
    [NaN, 8],
    [Infinity, 8],
    [MAX_SEGMENTS + 1, 8],
    [8, 1],
    [8, 2.5],
    [8, MAX_RINGS + 1],
    [-8, 8],
  ])('refuse segments = %s, anneaux = %s avec une RangeError claire', (segments, rings) => {
    expect(() => createSphere(segments, rings)).toThrow(RangeError)
    expect(() => createSphere(segments, rings)).toThrow(/entier entre/)
  })
})

describe('createCone', () => {
  const segments = 12
  const cone = createCone(segments)
  // Disposition des sommets : couronne du flanc, puis pointe, puis centre et couronne de la base.
  const apexStart = segments + 1
  const baseCenter = apexStart + segments
  const baseRingStart = baseCenter + 1

  it('a une base ronde (rayon 1, y = -1) et une pointe (y = +1) : hauteur 2', () => {
    const box = boundingBox(cone)!

    expect(box.min[1]).toBeCloseTo(-1, 5)
    expect(box.max[1]).toBeCloseTo(1, 5)
    expect(box.max[0]).toBeCloseTo(1, 5)
  })

  it('la base est plane : normale -Y pour son centre et toute sa couronne', () => {
    expect(vertex(cone.normals, baseCenter)).toEqual([0, -1, 0])
    for (let s = 0; s < segments; s++) {
      expect(vertex(cone.normals, baseRingStart + s)).toEqual([0, -1, 0])
      expect(vertex(cone.positions, baseRingStart + s)[1]).toBeCloseTo(-1, 5)
    }
  })

  it('la normale du flanc est perpendiculaire à la surface (à la génératrice et à la tangente)', () => {
    for (let s = 0; s < segments; s++) {
      const position = vertex(cone.positions, s)
      const normal = vertex(cone.normals, s)
      const towardApex = subtract([0, 1, 0], position) // la génératrice : du bord vers la pointe
      const angle = (2 * Math.PI * s) / segments
      const tangent: Vec3 = [-Math.sin(angle), 0, Math.cos(angle)]

      expect(dot(normal, towardApex)).toBeCloseTo(0, 5)
      expect(dot(normal, tangent)).toBeCloseTo(0, 5)
      expect(normal[1]).toBeGreaterThan(0) // le flanc regarde vers le haut
    }
  })

  it('la pointe a un sommet par tranche : même position, normales toutes différentes', () => {
    const normals = new Set<string>()
    for (let s = 0; s < segments; s++) {
      expect(vertex(cone.positions, apexStart + s)).toEqual([0, 1, 0])
      const n = vertex(cone.normals, apexStart + s)
      expect(n[1]).toBeCloseTo(1 / Math.sqrt(5), 5) // même inclinaison que le flanc
      normals.add(n.map((c) => c.toFixed(4)).join(','))
    }
    expect(normals.size).toBe(segments)
  })

  it('la normale de pointe d\'une tranche pointe vers le milieu de cette tranche', () => {
    for (let s = 0; s < segments; s++) {
      const n = vertex(cone.normals, apexStart + s)
      const middle = (2 * Math.PI * (s + 0.5)) / segments
      expect(Math.atan2(n[2], n[0])).toBeCloseTo(Math.atan2(Math.sin(middle), Math.cos(middle)), 5)
    }
  })

  it.each([2, 3.5, NaN, MAX_SEGMENTS + 1])('refuse segments = %s', (segments) => {
    expect(() => createCone(segments)).toThrow(RangeError)
  })
})

describe('createShape', () => {
  it.each(SHAPE_IDS)('« %s » fabrique une forme bien formée', (id) => {
    const mesh = createShape(id)

    expect(triangleCount(mesh)).toBeGreaterThan(0)
    expectWellFormed(mesh)
  })

  it('propose le cube, la sphère, le plan et le cône', () => {
    expect([...SHAPE_IDS]).toEqual(['cube', 'sphere', 'plane', 'cone'])
  })
})
