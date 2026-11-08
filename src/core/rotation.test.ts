import { MAX_DELTA_SECONDS, advanceRotation } from './rotation'

describe('advanceRotation', () => {
  it("avance proportionnellement au temps écoulé", () => {
    expect(advanceRotation(1, 0.05, 2)).toBeCloseTo(1.1)
  })

  it('donne le même résultat en deux demi-pas qu\'en un pas (indépendant de la fréquence d\'image)', () => {
    const oneStep = advanceRotation(0, 0.04, 3)
    const twoSteps = advanceRotation(advanceRotation(0, 0.02, 3), 0.02, 3)
    expect(twoSteps).toBeCloseTo(oneStep)
  })

  it('plafonne un grand temps écoulé (onglet resté caché) pour éviter un saut', () => {
    expect(advanceRotation(0, 5, 1)).toBeCloseTo(MAX_DELTA_SECONDS)
  })

  it.each([0, -1, NaN, Infinity])('ignore un temps écoulé invalide (%s)', (delta) => {
    expect(advanceRotation(1.5, delta, 2)).toBe(1.5)
  })
})
