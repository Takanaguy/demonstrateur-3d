import { DEFAULT_VIEW_OPTIONS } from './viewOptions'

describe('DEFAULT_VIEW_OPTIONS', () => {
  it("garde le comportement d'avant les options : l'objet tourne seul, le culling est désactivé (décision 13)", () => {
    expect(DEFAULT_VIEW_OPTIONS).toEqual({ autoRotate: true, backfaceCulling: false })
  })
})
