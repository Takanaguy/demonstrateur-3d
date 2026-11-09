import { createCubeGeometry } from './cube'
import {
  boundingBox,
  computeSmoothNormals,
  createIndexArray,
  normalizeToUnitBox,
  triangleCount,
  vertexCount,
  type Mesh,
} from './mesh'
import { length } from './vec3'

/** Un maillage réduit à ses positions : suffisant pour tester la boîte et la normalisation. */
function meshOf(positions: number[], indices: number[] = []): Mesh {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length).fill(0),
    indices: new Uint16Array(indices),
  }
}

describe('vertexCount et triangleCount', () => {
  it('comptent les sommets (3 flottants) et les triangles (3 indices)', () => {
    const cube = createCubeGeometry(2)

    expect(vertexCount(cube)).toBe(24)
    expect(triangleCount(cube)).toBe(12)
  })

  it('valent 0 pour un maillage vide', () => {
    const empty = meshOf([])

    expect(vertexCount(empty)).toBe(0)
    expect(triangleCount(empty)).toBe(0)
  })
})

describe('boundingBox', () => {
  it('trouve le minimum et le maximum sur chaque axe', () => {
    const mesh = meshOf([1, -2, 3, -4, 5, 0, 2, 2, -7])

    expect(boundingBox(mesh)).toEqual({ min: [-4, -2, -7], max: [2, 5, 3] })
  })

  it('un seul sommet : min et max sont égaux', () => {
    expect(boundingBox(meshOf([1, 2, 3]))).toEqual({ min: [1, 2, 3], max: [1, 2, 3] })
  })

  it('un cube de côté 2 va de -1 à +1', () => {
    expect(boundingBox(createCubeGeometry(2))).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] })
  })

  it('renvoie null pour un maillage sans sommet (pas de boîte à inventer)', () => {
    expect(boundingBox(meshOf([]))).toBeNull()
  })
})

describe('normalizeToUnitBox', () => {
  it('centre sur l\'origine et ramène le plus grand côté à 2', () => {
    // Boîte de (10, 10, 10) à (14, 12, 11) : côtés 4, 2, 1 -> échelle 0,5, centre (12, 11, 10,5).
    const mesh = meshOf([10, 10, 10, 14, 12, 11])

    const result = normalizeToUnitBox(mesh)

    expect(boundingBox(result)).toEqual({ min: [-1, -0.5, -0.25], max: [1, 0.5, 0.25] })
  })

  it('met à l\'échelle de façon uniforme : les proportions ne sont pas déformées', () => {
    const box = boundingBox(normalizeToUnitBox(meshOf([0, 0, 0, 8, 4, 2])))!

    const sides = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
    expect(sides).toEqual([2, 1, 0.5])
  })

  it('un modèle en centimètres (ou immense) tient dans la même boîte que s\'il était en mètres', () => {
    const small = normalizeToUnitBox(meshOf([-0.01, -0.01, -0.01, 0.01, 0.01, 0.01]))
    const huge = normalizeToUnitBox(meshOf([-5000, -5000, -5000, 5000, 5000, 5000]))

    expect(boundingBox(small)!.max[0]).toBeCloseTo(1, 5)
    expect(boundingBox(huge)!.max[0]).toBeCloseTo(1, 5)
  })

  it('un modèle plat (épaisseur nulle) est centré et mis à l\'échelle sur ses côtés non nuls', () => {
    const plane = normalizeToUnitBox(meshOf([0, 3, 0, 4, 3, 0, 4, 3, 4, 0, 3, 4]))

    expect(boundingBox(plane)).toEqual({ min: [-1, 0, -1], max: [1, 0, 1] })
  })

  it('ne modifie pas le maillage d\'origine et garde normales et indices tels quels', () => {
    const mesh: Mesh = {
      positions: new Float32Array([10, 10, 10, 20, 10, 10, 10, 20, 10]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    }
    const before = Array.from(mesh.positions)

    const result = normalizeToUnitBox(mesh)

    expect(Array.from(mesh.positions)).toEqual(before)
    expect(result.positions).not.toBe(mesh.positions)
    expect(Array.from(result.normals)).toEqual(Array.from(mesh.normals))
    expect(Array.from(result.indices)).toEqual([0, 1, 2])
  })

  it('conserve le type des indices (32 bits reste 32 bits)', () => {
    const mesh: Mesh = { ...meshOf([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }

    expect(normalizeToUnitBox(mesh).indices).toBeInstanceOf(Uint32Array)
  })

  it('est idempotent : normaliser un maillage déjà normalisé ne change rien', () => {
    const once = normalizeToUnitBox(meshOf([3, 4, 5, 9, 6, 7]))
    const twice = normalizeToUnitBox(once)

    Array.from(twice.positions).forEach((value, i) => expect(value).toBeCloseTo(once.positions[i]!, 5))
  })

  it('maillage vide : renvoie un maillage vide sans lever d\'exception', () => {
    const result = normalizeToUnitBox(meshOf([]))

    expect(result.positions).toHaveLength(0)
    expect(result.indices).toHaveLength(0)
  })

  it('boîte de taille nulle (un seul point) : centré sur l\'origine, sans NaN ni division par zéro', () => {
    const result = normalizeToUnitBox(meshOf([5, 6, 7, 5, 6, 7, 5, 6, 7]))

    expect(Array.from(result.positions)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('createIndexArray', () => {
  it('16 bits jusqu\'à 65 535 sommets (le plus grand indice est 65 534)', () => {
    expect(createIndexArray(3, 65_535)).toBeInstanceOf(Uint16Array)
  })

  it('32 bits dès 65 536 sommets', () => {
    expect(createIndexArray(3, 65_536)).toBeInstanceOf(Uint32Array)
  })

  it('a la longueur demandée', () => {
    expect(createIndexArray(9, 4)).toHaveLength(9)
  })
})

describe('computeSmoothNormals', () => {
  it('un triangle seul : la normale de son plan, pour chacun de ses sommets', () => {
    // Dans le plan XY, tourné dans le sens inverse des aiguilles d'une montre vu de +Z : normale +Z.
    const normals = computeSmoothNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2]))

    expect(Array.from(normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
  })

  it('pondère par l\'aire : un grand triangle compte plus qu\'un petit au sommet commun', () => {
    // Sommet 0 à l'origine, commun à un grand triangle (normale +Z, aire 2) et un petit (normale +X, aire 0,5).
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1])
    const indices = new Uint16Array([0, 1, 2, 0, 3, 4])

    const normals = computeSmoothNormals(positions, indices)

    // Somme pondérée = (1, 0, 4) : le rapport x/z vaut 1/4. Une moyenne simple donnerait 1.
    expect(normals[0]! / normals[2]!).toBeCloseTo(0.25, 5)
    expect(length([normals[0]!, normals[1]!, normals[2]!])).toBeCloseTo(1, 5)
  })

  it('toutes les normales calculées sont de longueur 1', () => {
    const cube = createCubeGeometry(2)

    const normals = computeSmoothNormals(cube.positions, cube.indices)

    for (let v = 0; v < 24; v++) {
      expect(length([normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!])).toBeCloseTo(1, 5)
    }
  })

  it('un sommet sans triangle, ou avec un triangle plat, reçoit +Y plutôt qu\'un NaN', () => {
    // Sommets 0 à 2 : triangle d'aire nulle (alignés). Sommet 3 : jamais utilisé.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 5, 5, 5])

    const normals = computeSmoothNormals(positions, new Uint16Array([0, 1, 2]))

    expect(Array.from(normals)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
  })
})
