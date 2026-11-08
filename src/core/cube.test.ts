import { createCubeGeometry } from './cube'
import { cross, dot, length, subtract, type Vec3 } from './vec3'

/** Lit le sommet `i` d'un tableau à 3 composantes par sommet. */
function vertex(data: Float32Array, i: number): Vec3 {
  return [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!]
}

describe('createCubeGeometry', () => {
  const { positions, normals, indices } = createCubeGeometry(2)

  it('a 24 sommets (4 par face) et 36 indices (12 triangles)', () => {
    expect(positions).toBeInstanceOf(Float32Array)
    expect(normals).toBeInstanceOf(Float32Array)
    expect(indices).toBeInstanceOf(Uint16Array)
    expect(positions).toHaveLength(24 * 3)
    expect(normals).toHaveLength(24 * 3)
    expect(indices).toHaveLength(36)
  })

  it('tous les indices désignent un sommet existant, [0, 24)', () => {
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(24)
    }
  })

  it('chaque sommet est utilisé par au moins un triangle', () => {
    expect(new Set(indices).size).toBe(24)
  })

  it('toutes les normales sont unitaires et alignées sur un axe', () => {
    for (let i = 0; i < 24; i++) {
      const n = vertex(normals, i)
      expect(length(n)).toBeCloseTo(1)
      expect(n.filter((c) => c !== 0)).toHaveLength(1)
    }
  })

  it('chaque face a 4 sommets de même normale, et 6 faces différentes en tout', () => {
    const seen = new Set<string>()
    for (let face = 0; face < 6; face++) {
      const first = vertex(normals, face * 4)
      for (let corner = 1; corner < 4; corner++) {
        expect(vertex(normals, face * 4 + corner)).toEqual(first)
      }
      seen.add(first.join(','))
    }
    expect(seen.size).toBe(6)
  })

  it('les sommets de chaque face sont à la bonne distance du centre, dans le plan de la face', () => {
    // Côté 2 : chaque face est à 1 du centre le long de sa normale.
    for (let i = 0; i < 24; i++) {
      expect(dot(vertex(positions, i), vertex(normals, i))).toBeCloseTo(1)
    }
  })

  it('chaque triangle utilise des sommets d\'une seule face et tourne dans le sens direct vu de l\'extérieur', () => {
    for (let t = 0; t < 12; t++) {
      const [ia, ib, ic] = [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!]
      // Les trois sommets d'un triangle viennent de la même face (indice / 4).
      expect(Math.floor(ia / 4)).toBe(Math.floor(ib / 4))
      expect(Math.floor(ia / 4)).toBe(Math.floor(ic / 4))

      const [a, b, c] = [vertex(positions, ia), vertex(positions, ib), vertex(positions, ic)]
      const faceNormal = cross(subtract(b, a), subtract(c, a))
      // Même sens que la normale déclarée : sinon le face culling effacerait la face visible.
      expect(dot(faceNormal, vertex(normals, ia))).toBeGreaterThan(0)
    }
  })

  it('les deux triangles d\'une face couvrent ses 4 coins', () => {
    for (let face = 0; face < 6; face++) {
      const used = new Set(indices.slice(face * 6, face * 6 + 6))
      expect([...used].sort((x, y) => x - y)).toEqual([face * 4, face * 4 + 1, face * 4 + 2, face * 4 + 3])
    }
  })

  it('la taille demandée est respectée (côté 1,5 : coordonnées en ±0,75)', () => {
    const cube = createCubeGeometry(1.5)
    expect(Math.max(...cube.positions)).toBeCloseTo(0.75)
    expect(Math.min(...cube.positions)).toBeCloseTo(-0.75)
  })

  it.each([0, -1, NaN, Infinity])('refuse la taille %s', (size) => {
    expect(() => createCubeGeometry(size)).toThrow(RangeError)
  })
})
