import { cross, dot, length, normalize, subtract } from './vec3'

describe('vec3', () => {
  it('subtract soustrait composante par composante', () => {
    expect(subtract([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6])
  })

  it('dot donne le produit scalaire (0 pour deux vecteurs perpendiculaires)', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0)
  })

  it('cross suit la règle de la main droite et est anticommutatif', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1])
    expect(cross([2, 3, 4], [5, 6, 7])).toEqual([-3, 6, -3])
  })

  it('length donne la longueur euclidienne', () => {
    expect(length([3, 4, 12])).toBe(13)
  })

  it('normalize renvoie un vecteur de longueur 1 dans la même direction', () => {
    const n = normalize([0, 3, 4])
    expect(n[0]).toBe(0)
    expect(n[1]).toBeCloseTo(0.6)
    expect(n[2]).toBeCloseTo(0.8)
    expect(length(n)).toBeCloseTo(1)
  })

  it('normalize refuse le vecteur nul et les valeurs invalides au lieu de produire NaN', () => {
    expect(() => normalize([0, 0, 0])).toThrow(RangeError)
    expect(() => normalize([NaN, 1, 0])).toThrow(/normaliser/)
    expect(() => normalize([Infinity, 0, 0])).toThrow(RangeError)
  })

  it('ne modifie pas ses arguments', () => {
    const a: [number, number, number] = [1, 2, 3]
    normalize(a)
    cross(a, [0, 1, 0])
    subtract(a, [1, 1, 1])
    expect(a).toEqual([1, 2, 3])
  })
})
