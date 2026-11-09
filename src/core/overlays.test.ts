import { createCubeGeometry } from './cube'
import { normalizeToUnitBox, triangleCount, type Mesh } from './mesh'
import {
  AXES_LENGTH,
  GRID_DIVISIONS,
  GRID_HALF_SIZE,
  GRID_HEIGHT,
  MAX_EDGE_TRIANGLES,
  MAX_NORMAL_SEGMENTS,
  axesSegments,
  boundingBoxSegments,
  edgesOfMesh,
  gridSegments,
  normalSegments,
  segmentCount,
} from './overlays'
import { createCone, createPlane, createShape, createSphere } from './shapes'

type Point = [number, number, number]
type Segment = [Point, Point]

/** Découpe une série de positions en segments (paires de points). */
function toSegments(positions: Float32Array): Segment[] {
  const result: Segment[] = []
  for (let i = 0; i < positions.length; i += 6) {
    result.push([
      [positions[i]!, positions[i + 1]!, positions[i + 2]!],
      [positions[i + 3]!, positions[i + 4]!, positions[i + 5]!],
    ])
  }
  return result
}

/** Nombre de coordonnées (sur 3) qui diffèrent entre les deux extrémités : 1 = arête d'un cube, 2 = diagonale d'une face. */
function differingAxes([a, b]: Segment): number {
  return [0, 1, 2].filter((axis) => Math.abs(a[axis]! - b[axis]!) > 1e-6).length
}

/** Une arête et sa version inversée doivent donner la même clé : on range les extrémités dans l'ordre. */
function undirectedKey([a, b]: Segment): string {
  const [first, second] = [a.join(','), b.join(',')].sort()
  return `${first}|${second}`
}

describe('segmentCount', () => {
  it('compte 6 flottants par segment', () => {
    expect(segmentCount(new Float32Array(18))).toBe(3)
    expect(segmentCount(new Float32Array(0))).toBe(0)
  })
})

describe('edgesOfMesh', () => {
  describe('le cube : 18 segments, pas 12 ni 36', () => {
    const cube = createCubeGeometry(2)
    const segments = toSegments(edgesOfMesh(cube))

    it("donne exactement 18 segments : ses 12 arêtes plus les 6 diagonales de la triangulation des faces carrées", () => {
      // 24 sommets (chaque coin en trois exemplaires) mais 8 positions : comparer les indices donnerait 36 arêtes.
      expect(segments).toHaveLength(18)
    })

    it('contient 12 arêtes de cube (une coordonnée change), 6 diagonales de face (deux changent), aucune diagonale du volume', () => {
      expect(segments.filter((s) => differingAxes(s) === 1)).toHaveLength(12)
      expect(segments.filter((s) => differingAxes(s) === 2)).toHaveLength(6)
      expect(segments.filter((s) => differingAxes(s) === 3)).toHaveLength(0)
    })

    it('ne contient aucun doublon, même dans le sens inverse', () => {
      expect(new Set(segments.map(undirectedKey)).size).toBe(segments.length)
    })

    it('chaque extrémité est un coin du cube (x, y et z valent tous ±1)', () => {
      for (const [a, b] of segments) {
        for (const point of [a, b]) for (const value of point) expect(Math.abs(value)).toBe(1)
      }
    })

    it('un cube plus gros donne le même nombre de segments (la tolérance de position est relative à la taille)', () => {
      expect(edgesOfMesh(createCubeGeometry(2000)).length / 6).toBe(18)
      expect(edgesOfMesh(createCubeGeometry(0.002)).length / 6).toBe(18)
    })
  })

  it('le plan : 5 segments (ses 4 côtés et la diagonale partagée par les deux triangles, comptée une seule fois)', () => {
    expect(segmentCount(edgesOfMesh(createPlane()))).toBe(5)
  })

  it('deux triangles aux sommets DOUBLÉS qui se touchent par une arête : cette arête n\'est dessinée qu\'une fois', () => {
    // Six sommets au lieu de quatre : l'arête (1,0,0)-(0,1,0) existe en deux exemplaires, aux indices 1-2 et 3-5.
    const mesh: Mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      normals: new Float32Array(18),
      indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
    }

    // 3 + 3 arêtes - 1 arête partagée = 5.
    expect(segmentCount(edgesOfMesh(mesh))).toBe(5)
  })

  describe('les formes fermées : les triangles dessinent leurs arêtes, sans doublon', () => {
    // Une sphère UV de S tranches et R anneaux a 2 + S(R-1) positions distinctes (deux pôles, S positions par
    // anneau intérieur, couture comprise) et 2 S (R-1) triangles. C'est une surface fermée : chaque arête touche
    // exactement deux triangles, donc le nombre d'arêtes vaut 3 x triangles / 2 = 3 S (R-1). (Contrôle avec la
    // formule d'Euler : sommets - arêtes + faces = 2 donne le même résultat.)
    it.each([
      [3, 2],
      [8, 4],
      [48, 24],
    ])('sphère de %i tranches et %i anneaux : 3 x S x (R - 1) segments', (segmentsCount, rings) => {
      const sphere = createSphere(segmentsCount, rings)

      const edges = edgesOfMesh(sphere)

      expect(segmentCount(edges)).toBe(3 * segmentsCount * (rings - 1))
      expect(segmentCount(edges)).toBe((3 * triangleCount(sphere)) / 2)
      // Contrôle des doublons : les arêtes sont toutes différentes.
      expect(new Set(toSegments(edges).map(undirectedKey)).size).toBe(segmentCount(edges))
    })

    it('la sphère proposée dans l\'interface (48 x 24) : 3 312 segments pour 2 208 triangles', () => {
      const sphere = createShape('sphere')
      expect(triangleCount(sphere)).toBe(2208)
      expect(segmentCount(edgesOfMesh(sphere))).toBe(3312)
    })

    it('la sphère, normalisée comme à l\'écran, donne le même nombre (les sommets de couture et du pôle sud ne sont pas exactement confondus)', () => {
      // Le sinus de PI vaut 1,2e-16 et non 0 : sans tolérance, le pôle sud compterait 49 sommets distincts.
      expect(segmentCount(edgesOfMesh(normalizeToUnitBox(createShape('sphere'))))).toBe(3312)
    })

    // Le cône est fermé aussi : une pointe, une couronne de S sommets, un centre de base. Triangles : 2 S,
    // sommets distincts : S + 2, donc arêtes = (S + 2) + 2 S - 2 = 3 S (S côtés de la base, S du centre à la
    // couronne, S de la couronne à la pointe).
    it.each([3, 8, 48])('cône de %i tranches : 3 x S segments', (segmentsCount) => {
      expect(segmentCount(edgesOfMesh(createCone(segmentsCount)))).toBe(3 * segmentsCount)
    })
  })

  it('chaque extrémité est la position d\'un sommet du maillage (rien n\'est inventé)', () => {
    const sphere = createSphere(8, 4)
    const known = new Set<string>()
    for (let v = 0; v < sphere.positions.length; v += 3) {
      known.add(`${sphere.positions[v]},${sphere.positions[v + 1]},${sphere.positions[v + 2]}`)
    }

    for (const [a, b] of toSegments(edgesOfMesh(sphere))) {
      expect(known.has(a.join(','))).toBe(true)
      expect(known.has(b.join(','))).toBe(true)
    }
  })

  it("ne dessine pas d'arête de longueur nulle (un triangle aplati en un point)", () => {
    const point: Mesh = {
      positions: new Float32Array([2, 2, 2, 2, 2, 2, 2, 2, 2]),
      normals: new Float32Array(9),
      indices: new Uint16Array([0, 1, 2]),
    }

    expect(edgesOfMesh(point)).toHaveLength(0)
  })

  it('un maillage vide ne donne aucune arête', () => {
    const empty: Mesh = { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint16Array(0) }

    expect(edgesOfMesh(empty)).toHaveLength(0)
  })

  it('accepte des indices 32 bits', () => {
    const triangle: Mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
    }

    expect(segmentCount(edgesOfMesh(triangle))).toBe(3)
  })

  it('refuse un maillage au-dessus du plafond de triangles, avec un message clair (et l\'accepte pile au plafond)', () => {
    const cube = createCubeGeometry(2) // 12 triangles

    expect(() => edgesOfMesh(cube, 11)).toThrow(RangeError)
    expect(() => edgesOfMesh(cube, 11)).toThrow(/12 triangles.*maximum est 11/)
    expect(() => edgesOfMesh(cube, 12)).not.toThrow()
  })

  it('le plafond par défaut est celui de MAX_EDGE_TRIANGLES (500 000), la moitié de la limite de l\'analyseur OBJ', () => {
    expect(MAX_EDGE_TRIANGLES).toBe(500_000)
  })

  it('refuse un indice hors limites plutôt que de produire des positions NaN', () => {
    const broken: Mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array(9),
      indices: new Uint16Array([0, 1, 3]),
    }

    expect(() => edgesOfMesh(broken)).toThrow(RangeError)
  })
})

describe('normalSegments', () => {
  const plane = createPlane(2) // 4 sommets, normale +Y partout

  it('un segment par sommet, du sommet vers sommet + normale x longueur', () => {
    const segments = toSegments(normalSegments(plane, 0.5, 100))

    expect(segments).toHaveLength(4)
    segments.forEach(([start, end], v) => {
      expect(start).toEqual([plane.positions[v * 3], plane.positions[v * 3 + 1], plane.positions[v * 3 + 2]])
      // Normale (0, 1, 0) : seule la hauteur change, de exactement 0,5.
      expect(end[0]).toBe(start[0])
      expect(end[1]).toBeCloseTo(start[1] + 0.5)
      expect(end[2]).toBe(start[2])
    })
  })

  it('la longueur de chaque segment est la longueur demandée, dans la direction de la normale (cas oblique)', () => {
    const slanted: Mesh = {
      positions: new Float32Array([1, 2, 3]),
      normals: new Float32Array([0.6, 0, 0.8]), // longueur 1
      indices: new Uint16Array([0, 0, 0]),
    }

    const [[start, end]] = toSegments(normalSegments(slanted, 2, 10)) as [Segment]

    expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])).toBeCloseTo(2)
    expect(end[0]).toBeCloseTo(1 + 1.2)
    expect(end[1]).toBeCloseTo(2)
    expect(end[2]).toBeCloseTo(3 + 1.6)
  })

  it('sans dépassement : autant de segments que de sommets quand il y en a assez peu (ici pile le plafond)', () => {
    expect(segmentCount(normalSegments(plane, 0.1, 4))).toBe(4)
    expect(segmentCount(normalSegments(createShape('sphere'), 0.1, MAX_NORMAL_SEGMENTS))).toBe(1225)
  })

  it('échantillonne régulièrement un sommet sur k : 10 sommets, plafond 4, k = 3, donc les sommets 0, 3, 6 et 9', () => {
    const positions = new Float32Array(30)
    for (let v = 0; v < 10; v++) positions[v * 3] = v // la coordonnée x vaut le numéro du sommet
    const mesh: Mesh = { positions, normals: new Float32Array(30), indices: new Uint16Array([0, 1, 2]) }
    for (let v = 0; v < 10; v++) mesh.normals[v * 3 + 1] = 1 // toutes les normales vers +Y

    const starts = toSegments(normalSegments(mesh, 1, 4)).map(([start]) => start[0])

    expect(starts).toEqual([0, 3, 6, 9])
  })

  it.each([
    [1000, 4000],
    [4000, 4000],
    [4001, 4000],
    [7999, 4000],
    [8000, 4000],
    [8001, 4000],
    [100_000, 4000],
    [10, 1],
    [10, 3],
    [10, 9],
    [7, 2],
  ])('%i sommets, plafond %i : ne dépasse jamais le plafond, et en garde au moins la moitié', (vertices, max) => {
    const mesh: Mesh = {
      positions: new Float32Array(vertices * 3),
      normals: new Float32Array(vertices * 3),
      indices: new Uint32Array([0, 0, 0]),
    }

    const count = segmentCount(normalSegments(mesh, 1, max))

    expect(count).toBeLessThanOrEqual(max)
    expect(count).toBeGreaterThanOrEqual(Math.min(vertices, max) / 2)
  })

  it('un maillage vide ne donne aucune normale', () => {
    const empty: Mesh = { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint16Array(0) }

    expect(normalSegments(empty, 1, 10)).toHaveLength(0)
  })

  it('refuse une longueur ou un plafond invalides, et des normales qui ne correspondent pas aux positions', () => {
    expect(() => normalSegments(plane, 0, 10)).toThrow(RangeError)
    expect(() => normalSegments(plane, Number.NaN, 10)).toThrow(RangeError)
    expect(() => normalSegments(plane, 1, 0)).toThrow(RangeError)
    expect(() => normalSegments(plane, 1, 2.5)).toThrow(RangeError)
    expect(() => normalSegments({ ...plane, normals: new Float32Array(3) }, 1, 10)).toThrow(RangeError)
  })
})

describe('boundingBoxSegments', () => {
  const mesh: Mesh = {
    positions: new Float32Array([-1, 0, 2, 3, 5, 4, 0, 1, 3]),
    normals: new Float32Array(9),
    indices: new Uint16Array([0, 1, 2]),
  }
  const segments = toSegments(boundingBoxSegments(mesh))

  it('12 segments', () => {
    expect(segments).toHaveLength(12)
  })

  it('les 8 coins de la boîte [-1, 3] x [0, 5] x [2, 4] : chacun relie 3 arêtes, toutes sont différentes', () => {
    const degree = new Map<string, number>()
    for (const [a, b] of segments) {
      for (const point of [a, b]) degree.set(point.join(','), (degree.get(point.join(',')) ?? 0) + 1)
    }

    expect([...degree.keys()].sort()).toEqual(
      ['-1,0,2', '-1,0,4', '-1,5,2', '-1,5,4', '3,0,2', '3,0,4', '3,5,2', '3,5,4'].sort(),
    )
    expect([...degree.values()]).toEqual(Array(8).fill(3))
    expect(new Set(segments.map(undirectedKey)).size).toBe(12)
  })

  it('chaque arête est parallèle à un axe (une seule coordonnée change), dans une boîte de la bonne taille', () => {
    expect(segments.every((s) => differingAxes(s) === 1)).toBe(true)
    // 4 arêtes par axe, de longueur 4 (X), 5 (Y) et 2 (Z).
    const lengths = segments.map(([a, b]) => Math.max(...[0, 1, 2].map((axis) => Math.abs(a[axis]! - b[axis]!))))
    expect(lengths.filter((l) => l === 4)).toHaveLength(4)
    expect(lengths.filter((l) => l === 5)).toHaveLength(4)
    expect(lengths.filter((l) => l === 2)).toHaveLength(4)
  })

  it('un cube normalisé a sa boîte de -1 à +1 (les coins touchent le cube)', () => {
    const corners = toSegments(boundingBoxSegments(normalizeToUnitBox(createCubeGeometry(40)))).flat()

    for (const point of corners) for (const value of point) expect(Math.abs(value)).toBe(1)
  })

  it('un maillage vide n\'a pas de boîte', () => {
    const empty: Mesh = { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint16Array(0) }

    expect(boundingBoxSegments(empty)).toHaveLength(0)
  })
})

describe('gridSegments', () => {
  it('une petite grille connue : demi-côté 1, 2 divisions, hauteur 0 : 3 lignes dans chaque sens, aux abscisses -1, 0 et 1', () => {
    const segments = toSegments(gridSegments(1, 2, 0))

    expect(segments).toHaveLength(6)
    const alongZ = segments.filter(([a, b]) => a[0] === b[0]) // x fixé : ligne parallèle à Z
    const alongX = segments.filter(([a, b]) => a[2] === b[2]) // z fixé : ligne parallèle à X
    expect(alongZ.map(([a]) => a[0]).sort()).toEqual([-1, 0, 1])
    expect(alongX.map(([a]) => a[2]).sort()).toEqual([-1, 0, 1])
    // Chaque ligne va de bord à bord.
    for (const [a, b] of alongZ) expect([a[2], b[2]]).toEqual([-1, 1])
    for (const [a, b] of alongX) expect([a[0], b[0]]).toEqual([-1, 1])
  })

  it('les valeurs de l\'application : 26 segments à y = -1,2, bords à ±3, une ligne tous les 0,5, dont une sur chaque axe', () => {
    const segments = toSegments(gridSegments(GRID_HALF_SIZE, GRID_DIVISIONS, GRID_HEIGHT))

    expect(segments).toHaveLength(2 * (12 + 1))
    for (const [a, b] of segments) {
      expect(a[1]).toBe(Math.fround(-1.2))
      expect(b[1]).toBe(Math.fround(-1.2))
      for (const point of [a, b]) for (const axis of [0, 2]) expect(Math.abs(point[axis]!)).toBeLessThanOrEqual(3)
    }
    const alongZ = segments.filter(([a, b]) => a[0] === b[0]).map(([a]) => a[0])
    expect(alongZ).toEqual(Array.from({ length: 13 }, (_, i) => -3 + 0.5 * i))
    expect(alongZ).toContain(0)
  })

  it('refuse des paramètres invalides', () => {
    expect(() => gridSegments(0, 4, 0)).toThrow(RangeError)
    expect(() => gridSegments(Number.NaN, 4, 0)).toThrow(RangeError)
    expect(() => gridSegments(1, 0, 0)).toThrow(RangeError)
    expect(() => gridSegments(1, 2.5, 0)).toThrow(RangeError)
    expect(() => gridSegments(1, 4, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('la grille de l\'application est sous l\'objet unité (qui descend à -1) et le déborde de tous les côtés', () => {
    expect(GRID_HEIGHT).toBeLessThan(-1)
    expect(GRID_HALF_SIZE).toBeGreaterThan(Math.sqrt(3)) // le coin du cube, le point le plus éloigné
  })
})

describe('axesSegments', () => {
  it('trois segments depuis l\'origine, dans l\'ordre X, Y, Z', () => {
    expect(toSegments(axesSegments(2))).toEqual([
      [[0, 0, 0], [2, 0, 0]],
      [[0, 0, 0], [0, 2, 0]],
      [[0, 0, 0], [0, 0, 2]],
    ])
  })

  it('la longueur demandée est respectée', () => {
    expect(Array.from(axesSegments(AXES_LENGTH))).toContain(AXES_LENGTH)
    expect(Array.from(axesSegments(0.5)).filter((value) => value !== 0)).toEqual([0.5, 0.5, 0.5])
  })

  it('refuse une longueur invalide', () => {
    expect(() => axesSegments(0)).toThrow(RangeError)
    expect(() => axesSegments(-1)).toThrow(RangeError)
    expect(() => axesSegments(Number.NaN)).toThrow(RangeError)
  })
})
