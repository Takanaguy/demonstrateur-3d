import {
  AMBIENT_RANGE,
  DEFAULT_LIGHTING,
  GAUSSIAN_MEAN_RANGE,
  GAUSSIAN_STD_DEV_RANGE,
  LIGHTING_MODELS,
  POSITION_RANGE,
  SHININESS_RANGE,
  SPECULAR_RANGE,
  blinnPhongSpecular,
  gaussianSpecular,
  sanitizeLighting,
  type LightingSettings,
} from './lighting'

/** Des réglages valides où l'on change un seul champ, avec un type volontairement trompeur pour les tests d'entrées folles. */
function withChange(changes: Record<string, unknown>): LightingSettings {
  return { ...DEFAULT_LIGHTING, ...changes } as LightingSettings
}

describe('réglages par défaut et plages', () => {
  it('les valeurs par défaut sont celles de la décision de conception', () => {
    expect(DEFAULT_LIGHTING).toEqual({
      model: 'lambert',
      position: [3, 4, 5],
      color: '#FFFFFF',
      ambient: 0.35,
      specular: 0.6,
      shininess: 32,
      gaussianMean: 0,
      gaussianStdDev: 0.15,
    })
  })

  it('chaque réglage par défaut est dans sa plage (sinon sanitize le modifierait)', () => {
    expect(sanitizeLighting(DEFAULT_LIGHTING)).toEqual(DEFAULT_LIGHTING)
  })

  it('les plages sont celles attendues', () => {
    expect(POSITION_RANGE).toEqual({ min: -10, max: 10, step: 0.5 })
    expect(AMBIENT_RANGE).toMatchObject({ min: 0, max: 1 })
    expect(SPECULAR_RANGE).toMatchObject({ min: 0, max: 1 })
    expect(SHININESS_RANGE).toMatchObject({ min: 1, max: 256 })
    expect(GAUSSIAN_MEAN_RANGE).toMatchObject({ min: 0, max: 0.5 })
    expect(GAUSSIAN_STD_DEV_RANGE).toMatchObject({ min: 0.02, max: 1 })
  })

  it("l'écart type minimal n'est pas nul (division par zéro dans la formule gaussienne)", () => {
    expect(GAUSSIAN_STD_DEV_RANGE.min).toBeGreaterThan(0)
  })

  it('les trois modèles existent', () => {
    expect(LIGHTING_MODELS).toEqual(['lambert', 'blinn-phong', 'gaussian'])
  })
})

describe('sanitizeLighting : bornes', () => {
  it('rend des réglages valides tels quels, sans les modifier', () => {
    const settings: LightingSettings = {
      model: 'gaussian',
      position: [-2.5, 0, 9],
      color: '#12aB9f',
      ambient: 0.5,
      specular: 0.25,
      shininess: 100,
      gaussianMean: 0.3,
      gaussianStdDev: 0.4,
    }
    expect(sanitizeLighting(settings)).toEqual(settings)
  })

  it.each([
    ['ambient', 'ambient', 5, AMBIENT_RANGE.max],
    ['ambient', 'ambient', -1, AMBIENT_RANGE.min],
    ['specular', 'specular', 2, SPECULAR_RANGE.max],
    ['shininess', 'shininess', 100000, SHININESS_RANGE.max],
    ['shininess', 'shininess', 0, SHININESS_RANGE.min],
    ['gaussianMean', 'gaussianMean', 3, GAUSSIAN_MEAN_RANGE.max],
    ['gaussianMean', 'gaussianMean', -3, GAUSSIAN_MEAN_RANGE.min],
    ['gaussianStdDev', 'gaussianStdDev', 0, GAUSSIAN_STD_DEV_RANGE.min],
    ['gaussianStdDev', 'gaussianStdDev', 50, GAUSSIAN_STD_DEV_RANGE.max],
  ] as const)('%s hors plage : %s = %s est ramené à %s', (_label, field, value, expected) => {
    expect(sanitizeLighting(withChange({ [field]: value }))[field]).toBe(expected)
  })

  it('borne chaque coordonnée de la position séparément', () => {
    const result = sanitizeLighting(withChange({ position: [50, -50, 3] }))
    expect(result.position).toEqual([10, -10, 3])
  })

  it('ne modifie pas les réglages reçus', () => {
    const input = withChange({ ambient: 9, position: [99, 0, 0] })
    sanitizeLighting(input)
    expect(input.ambient).toBe(9)
    expect(input.position).toEqual([99, 0, 0])
  })
})

describe('sanitizeLighting : valeurs invalides', () => {
  it.each([
    ['ambient', Number.NaN],
    ['ambient', Number.POSITIVE_INFINITY],
    ['ambient', Number.NEGATIVE_INFINITY],
    ['specular', Number.NaN],
    ['shininess', Number.NaN],
    ['gaussianMean', Number.NaN],
    ['gaussianStdDev', Number.NaN],
    ['gaussianStdDev', Number.POSITIVE_INFINITY],
  ] as const)('%s = %s redevient la valeur par défaut', (field, value) => {
    expect(sanitizeLighting(withChange({ [field]: value }))[field]).toBe(DEFAULT_LIGHTING[field])
  })

  it('une coordonnée de position invalide redevient SA valeur par défaut, les autres sont gardées', () => {
    const result = sanitizeLighting(withChange({ position: [Number.NaN, 7, Number.POSITIVE_INFINITY] }))
    expect(result.position).toEqual([DEFAULT_LIGHTING.position[0], 7, DEFAULT_LIGHTING.position[2]])
  })

  it('un texte à la place d\'un nombre redevient la valeur par défaut', () => {
    expect(sanitizeLighting(withChange({ ambient: '0.8' })).ambient).toBe(DEFAULT_LIGHTING.ambient)
  })

  it('une position absente ou trop courte redevient la position par défaut', () => {
    expect(sanitizeLighting(withChange({ position: undefined })).position).toEqual(DEFAULT_LIGHTING.position)
    expect(sanitizeLighting(withChange({ position: [1] })).position).toEqual([1, 4, 5])
  })

  it('un modèle inconnu redevient le modèle par défaut', () => {
    expect(sanitizeLighting(withChange({ model: 'phong' })).model).toBe('lambert')
    expect(sanitizeLighting(withChange({ model: undefined })).model).toBe('lambert')
  })

  it.each(['rouge', '#FFF', '#GGGGGG', '#12345', '#1234567', 'FFFFFF', '', 42])(
    'la couleur invalide %j redevient #FFFFFF',
    (color) => {
      expect(sanitizeLighting(withChange({ color })).color).toBe('#FFFFFF')
    },
  )

  it('accepte une couleur en minuscules comme en majuscules', () => {
    expect(sanitizeLighting(withChange({ color: '#ff8800' })).color).toBe('#ff8800')
    expect(sanitizeLighting(withChange({ color: '#FF8800' })).color).toBe('#FF8800')
  })

  it('même avec tous les champs fous, le résultat ne contient que des nombres finis', () => {
    const result = sanitizeLighting(
      withChange({
        position: [Number.NaN, Number.NaN, Number.NaN],
        ambient: Number.NaN,
        specular: Number.NaN,
        shininess: Number.NaN,
        gaussianMean: Number.NaN,
        gaussianStdDev: Number.NaN,
      }),
    )
    const numbers = [...result.position, result.ambient, result.specular, result.shininess, result.gaussianMean, result.gaussianStdDev]
    expect(numbers.every(Number.isFinite)).toBe(true)
  })
})

describe('blinnPhongSpecular', () => {
  it('vaut 1 quand la normale est pile sur le demi-vecteur (N·H = 1), quelle que soit la brillance', () => {
    expect(blinnPhongSpecular(1, 1)).toBe(1)
    expect(blinnPhongSpecular(1, 32)).toBe(1)
    expect(blinnPhongSpecular(1, 256)).toBe(1)
  })

  it('vaut 0 quand N·H = 0, et aussi quand il est négatif (pas de reflet dos au demi-vecteur)', () => {
    expect(blinnPhongSpecular(0, 32)).toBe(0)
    expect(blinnPhongSpecular(-0.5, 32)).toBe(0)
    expect(blinnPhongSpecular(-1, 3)).toBe(0) // exposant impair : sans le max(., 0) le résultat serait négatif
  })

  it('est une puissance : 0,5 à la puissance 2 donne 0,25', () => {
    expect(blinnPhongSpecular(0.5, 2)).toBeCloseTo(0.25, 10)
  })

  it('augmente avec N·H (plus la normale est proche du demi-vecteur, plus le reflet est fort)', () => {
    const values = [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1].map((nDotH) => blinnPhongSpecular(nDotH, 32))
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!)
  })

  it('un reflet plus brillant est plus étroit : à N·H < 1, la valeur diminue quand la brillance augmente', () => {
    expect(blinnPhongSpecular(0.9, 64)).toBeLessThan(blinnPhongSpecular(0.9, 8))
  })
})

describe('gaussianSpecular', () => {
  it('est maximal (1) quand theta vaut la moyenne', () => {
    // theta = acos(nDotH) ; on choisit nDotH = cos(moyenne).
    for (const mean of [0, 0.2, 0.5]) {
      expect(gaussianSpecular(Math.cos(mean), mean, 0.15)).toBeCloseTo(1, 10)
    }
  })

  it('vaut exp(-0,5) à un écart type de la moyenne', () => {
    const mean = 0.1
    const stdDev = 0.2
    expect(gaussianSpecular(Math.cos(mean + stdDev), mean, stdDev)).toBeCloseTo(Math.exp(-0.5), 10)
  })

  it('vaut exp(-2) à deux écarts types', () => {
    expect(gaussianSpecular(Math.cos(0.3), 0, 0.15)).toBeCloseTo(Math.exp(-2), 10)
  })

  it('est symétrique autour de la moyenne : mêmes valeurs à égale distance de part et d\'autre', () => {
    const mean = 0.3
    const stdDev = 0.1
    const below = gaussianSpecular(Math.cos(mean - 0.07), mean, stdDev)
    const above = gaussianSpecular(Math.cos(mean + 0.07), mean, stdDev)
    expect(below).toBeCloseTo(above, 10)
  })

  it('un écart type plus petit donne un reflet plus fin', () => {
    const nDotH = Math.cos(0.2)
    expect(gaussianSpecular(nDotH, 0, 0.05)).toBeLessThan(gaussianSpecular(nDotH, 0, 0.3))
  })

  it("ne renvoie jamais NaN, même si N·H dépasse 1 par erreur d'arrondi", () => {
    expect(gaussianSpecular(1.0000001, 0, 0.15)).toBe(1)
    expect(gaussianSpecular(-1.0000001, 0, 0.15)).toBeCloseTo(0, 10)
    expect(Number.isNaN(gaussianSpecular(5, 0, 0.15))).toBe(false)
  })

  it('reste entre 0 et 1', () => {
    for (const nDotH of [-1, -0.3, 0, 0.5, 0.99, 1]) {
      const value = gaussianSpecular(nDotH, 0.2, 0.1)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})
