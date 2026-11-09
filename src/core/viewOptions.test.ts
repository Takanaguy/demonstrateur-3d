import { DEFAULT_VIEW_OPTIONS, DISPLAY_MODES, drawsEdges, drawsFill } from './viewOptions'

describe('DEFAULT_VIEW_OPTIONS', () => {
  it("garde l'affichage d'avant les options : l'objet tourne, plein, culling désactivé (décision 13), aucune aide dessinée", () => {
    expect(DEFAULT_VIEW_OPTIONS).toEqual({
      autoRotate: true,
      backfaceCulling: false,
      displayMode: 'solid',
      showNormals: false,
      showBoundingBox: false,
      showGrid: false,
      showAxes: false,
    })
  })
})

describe('modes d\'affichage', () => {
  it.each([
    ['solid', true, false],
    ['wireframe', false, true],
    ['solid-wireframe', true, true],
  ] as const)('%s : remplissage %s, arêtes %s', (mode, fill, edges) => {
    expect(drawsFill(mode)).toBe(fill)
    expect(drawsEdges(mode)).toBe(edges)
  })

  it('chaque mode dessine quelque chose (jamais un écran vide à cause du mode)', () => {
    for (const mode of DISPLAY_MODES) expect(drawsFill(mode) || drawsEdges(mode), mode).toBe(true)
  })

  it('propose les trois modes, plein en premier (le mode par défaut)', () => {
    expect(DISPLAY_MODES).toEqual(['solid', 'wireframe', 'solid-wireframe'])
    expect(DISPLAY_MODES[0]).toBe(DEFAULT_VIEW_OPTIONS.displayMode)
  })
})
