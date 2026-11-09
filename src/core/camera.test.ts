import {
  CAMERA_TARGET,
  CAMERA_UP,
  DEFAULT_CAMERA,
  DISTANCE_RANGE,
  ELEVATION_RANGE,
  cameraPosition,
  orbitCamera,
  sanitizeCamera,
  zoomCamera,
  type OrbitCamera,
} from './camera'
import { lookAt } from './mat4'

/** Vrai si les trois nombres de la caméra sont dans leurs plages et finis. */
function isSane(camera: OrbitCamera): boolean {
  return (
    Number.isFinite(camera.azimuth) &&
    camera.azimuth >= -Math.PI &&
    camera.azimuth <= Math.PI &&
    Number.isFinite(camera.elevation) &&
    camera.elevation >= ELEVATION_RANGE.min &&
    camera.elevation <= ELEVATION_RANGE.max &&
    Number.isFinite(camera.distance) &&
    camera.distance >= DISTANCE_RANGE.min &&
    camera.distance <= DISTANCE_RANGE.max
  )
}

describe('DEFAULT_CAMERA', () => {
  it("garde l'ancien point de vue : sur l'axe +Z, à 5 unités, élevée de 0,4 rad (l'ancienne inclinaison)", () => {
    expect(DEFAULT_CAMERA).toEqual({ azimuth: 0, elevation: 0.4, distance: 5 })
  })

  it('est dans les plages autorisées', () => {
    expect(isSane(DEFAULT_CAMERA)).toBe(true)
  })

  it('les plages sont cohérentes : le pôle (PI/2) est exclu, et la caméra reste hors de la sphère de l\'objet (rayon racine de 3)', () => {
    expect(ELEVATION_RANGE.max).toBeLessThan(Math.PI / 2)
    expect(ELEVATION_RANGE.min).toBe(-ELEVATION_RANGE.max)
    expect(DISTANCE_RANGE.min).toBeGreaterThan(Math.sqrt(3))
    expect(DISTANCE_RANGE.min).toBeLessThan(DISTANCE_RANGE.max)
  })
})

describe('cameraPosition : coordonnées sphériques vers cartésiennes', () => {
  it('azimut 0 et élévation 0 : la caméra est sur l\'axe +Z', () => {
    const [x, y, z] = cameraPosition({ azimuth: 0, elevation: 0, distance: 5 })
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(5)
  })

  it('azimut PI/2 : la caméra passe sur l\'axe +X (un azimut positif va vers la droite)', () => {
    const [x, y, z] = cameraPosition({ azimuth: Math.PI / 2, elevation: 0, distance: 4 })
    expect(x).toBeCloseTo(4)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(0)
  })

  it('azimut PI : la caméra est derrière l\'objet, sur l\'axe -Z', () => {
    const [x, , z] = cameraPosition({ azimuth: Math.PI, elevation: 0, distance: 4 })
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(-4)
  })

  it('élévation positive : la caméra monte, et sa part horizontale rétrécit', () => {
    const [x, y, z] = cameraPosition({ azimuth: 0, elevation: Math.PI / 6, distance: 10 })
    expect(y).toBeCloseTo(5) // 10 * sin(30 degrés)
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(10 * Math.cos(Math.PI / 6))
  })

  it('élévation négative : la caméra passe sous l\'objet', () => {
    expect(cameraPosition({ azimuth: 0, elevation: -0.5, distance: 5 })[1]).toBeLessThan(0)
  })

  it('la position de départ est (0, 5 sin 0,4, 5 cos 0,4)', () => {
    const [x, y, z] = cameraPosition(DEFAULT_CAMERA)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(5 * Math.sin(0.4))
    expect(z).toBeCloseTo(5 * Math.cos(0.4))
  })

  it('la caméra est toujours à la distance demandée de l\'origine, quels que soient les angles', () => {
    for (const azimuth of [-3, -1, 0, 0.7, 2.5]) {
      for (const elevation of [-1.5, -0.3, 0, 0.9, 1.5]) {
        const [x, y, z] = cameraPosition({ azimuth, elevation, distance: 7 })
        expect(Math.hypot(x, y, z)).toBeCloseTo(7)
      }
    }
  })
})

describe('sanitizeCamera', () => {
  it('rend telle quelle une caméra valide, sans la modifier au passage', () => {
    const camera = { azimuth: 0.3, elevation: -0.7, distance: 8 }
    expect(sanitizeCamera(camera)).toEqual(camera)
    expect(sanitizeCamera(DEFAULT_CAMERA)).toEqual(DEFAULT_CAMERA)
  })

  it('borne l\'élévation et la distance à leurs plages', () => {
    expect(sanitizeCamera({ azimuth: 0, elevation: 9, distance: 5 }).elevation).toBe(ELEVATION_RANGE.max)
    expect(sanitizeCamera({ azimuth: 0, elevation: -9, distance: 5 }).elevation).toBe(ELEVATION_RANGE.min)
    expect(sanitizeCamera({ azimuth: 0, elevation: 0, distance: 0.1 }).distance).toBe(DISTANCE_RANGE.min)
    expect(sanitizeCamera({ azimuth: 0, elevation: 0, distance: 500 }).distance).toBe(DISTANCE_RANGE.max)
  })

  it('remplace NaN et Infinity par les valeurs de DEFAULT_CAMERA, sans jamais en laisser passer', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(sanitizeCamera({ azimuth: bad, elevation: bad, distance: bad })).toEqual(DEFAULT_CAMERA)
    }
  })

  it('remplace aussi ce qui n\'est pas un nombre (texte, undefined)', () => {
    const crazy = { azimuth: 'x', elevation: undefined, distance: null } as unknown as OrbitCamera
    expect(sanitizeCamera(crazy)).toEqual(DEFAULT_CAMERA)
  })

  it('ramène un azimut trop grand dans [-PI, PI], sans changer la direction', () => {
    const wrapped = sanitizeCamera({ azimuth: 3 * Math.PI, elevation: 0, distance: 5 }).azimuth
    expect(Math.abs(wrapped)).toBeCloseTo(Math.PI)
    const wrapped2 = sanitizeCamera({ azimuth: 0.5 + 4 * Math.PI, elevation: 0, distance: 5 }).azimuth
    expect(wrapped2).toBeCloseTo(0.5)
    const wrapped3 = sanitizeCamera({ azimuth: -0.5 - 6 * Math.PI, elevation: 0, distance: 5 }).azimuth
    expect(wrapped3).toBeCloseTo(-0.5)
  })

  it('garde un azimut très grand (mais fini) dans l\'intervalle', () => {
    const { azimuth } = sanitizeCamera({ azimuth: 1e15, elevation: 0, distance: 5 })
    expect(azimuth).toBeGreaterThanOrEqual(-Math.PI)
    expect(azimuth).toBeLessThanOrEqual(Math.PI)
  })

  it('ne modifie pas la caméra reçue', () => {
    const camera = { azimuth: 10, elevation: 10, distance: 100 }
    sanitizeCamera(camera)
    expect(camera).toEqual({ azimuth: 10, elevation: 10, distance: 100 })
  })
})

describe('orbitCamera', () => {
  it('ajoute les écarts à l\'azimut et à l\'élévation, sans toucher à la distance', () => {
    const next = orbitCamera({ azimuth: 0.2, elevation: 0.1, distance: 6 }, 0.5, -0.3)
    expect(next.azimuth).toBeCloseTo(0.7)
    expect(next.elevation).toBeCloseTo(-0.2)
    expect(next.distance).toBe(6)
  })

  it('renvoie une nouvelle caméra et laisse l\'ancienne intacte', () => {
    const camera = { ...DEFAULT_CAMERA }
    const next = orbitCamera(camera, 1, 0.1)
    expect(next).not.toBe(camera)
    expect(camera).toEqual(DEFAULT_CAMERA)
  })

  it('l\'élévation s\'arrête aux bornes : tourner sans fin vers le haut ne passe pas le pôle', () => {
    let camera = DEFAULT_CAMERA
    for (let i = 0; i < 100; i++) camera = orbitCamera(camera, 0, 0.3)
    expect(camera.elevation).toBe(ELEVATION_RANGE.max)
    for (let i = 0; i < 100; i++) camera = orbitCamera(camera, 0, -0.3)
    expect(camera.elevation).toBe(ELEVATION_RANGE.min)
  })

  it('l\'azimut ne grandit pas sans fin : après 50 tours, il est toujours dans [-PI, PI]', () => {
    let camera = DEFAULT_CAMERA
    for (let i = 0; i < 500; i++) camera = orbitCamera(camera, 0.2, 0)
    expect(camera.azimuth).toBeGreaterThanOrEqual(-Math.PI)
    expect(camera.azimuth).toBeLessThanOrEqual(Math.PI)
    // 500 * 0,2 = 100 rad : la direction est la même qu'un azimut de 100 modulo 2 PI.
    expect(Math.cos(camera.azimuth)).toBeCloseTo(Math.cos(100), 6)
    expect(Math.sin(camera.azimuth)).toBeCloseTo(Math.sin(100), 6)
  })

  it('un tour complet ramène à la même direction', () => {
    const next = orbitCamera(DEFAULT_CAMERA, 2 * Math.PI, 0)
    expect(next.azimuth).toBeCloseTo(DEFAULT_CAMERA.azimuth)
  })

  it('ignore un écart qui n\'est pas un nombre fini (jamais de NaN dans la caméra)', () => {
    const next = orbitCamera(DEFAULT_CAMERA, Number.NaN, Number.POSITIVE_INFINITY)
    expect(next).toEqual(DEFAULT_CAMERA)
  })
})

describe('zoomCamera', () => {
  it('multiplie la distance : le zoom est proportionnel, pas additif', () => {
    expect(zoomCamera({ ...DEFAULT_CAMERA, distance: 4 }, 1.5).distance).toBeCloseTo(6)
    expect(zoomCamera({ ...DEFAULT_CAMERA, distance: 10 }, 0.5).distance).toBeCloseTo(5)
    // Même facteur, même effet RELATIF près ou loin (un ajout fixe n'aurait pas cette propriété).
    const near = zoomCamera({ ...DEFAULT_CAMERA, distance: 3 }, 1.1).distance / 3
    const far = zoomCamera({ ...DEFAULT_CAMERA, distance: 9 }, 1.1).distance / 9
    expect(near).toBeCloseTo(far)
  })

  it('un facteur plus petit que 1 rapproche, plus grand que 1 éloigne', () => {
    expect(zoomCamera(DEFAULT_CAMERA, 0.9).distance).toBeLessThan(DEFAULT_CAMERA.distance)
    expect(zoomCamera(DEFAULT_CAMERA, 1.1).distance).toBeGreaterThan(DEFAULT_CAMERA.distance)
  })

  it('est borné : on ne peut ni entrer dans l\'objet ni s\'envoler', () => {
    expect(zoomCamera(DEFAULT_CAMERA, 0.0001).distance).toBe(DISTANCE_RANGE.min)
    expect(zoomCamera(DEFAULT_CAMERA, 10000).distance).toBe(DISTANCE_RANGE.max)
  })

  it('ne touche ni à l\'azimut ni à l\'élévation', () => {
    const next = zoomCamera({ azimuth: 1, elevation: -0.5, distance: 5 }, 1.2)
    expect(next.azimuth).toBe(1)
    expect(next.elevation).toBe(-0.5)
  })

  it('ignore un facteur invalide (NaN, infini, zéro, négatif) au lieu de casser la distance', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -2]) {
      expect(zoomCamera(DEFAULT_CAMERA, bad)).toEqual(DEFAULT_CAMERA)
    }
  })

  it('renvoie une nouvelle caméra et laisse l\'ancienne intacte', () => {
    const camera = { ...DEFAULT_CAMERA }
    zoomCamera(camera, 2)
    expect(camera).toEqual(DEFAULT_CAMERA)
  })
})

describe('lookAt reste valide sur toute la plage de la caméra', () => {
  it('ne lève jamais d\'erreur et ne produit jamais de NaN, élévation aux deux bornes comprises', () => {
    for (const elevation of [ELEVATION_RANGE.min, -1, 0, 1, ELEVATION_RANGE.max]) {
      for (const azimuth of [-Math.PI, -2, -0.5, 0, 1, Math.PI / 2, Math.PI]) {
        for (const distance of [DISTANCE_RANGE.min, 5, DISTANCE_RANGE.max]) {
          const eye = cameraPosition({ azimuth, elevation, distance })
          let view: Float32Array | undefined
          expect(() => {
            view = lookAt(eye, CAMERA_TARGET, CAMERA_UP)
          }).not.toThrow()
          expect(Array.from(view!).every(Number.isFinite)).toBe(true)
        }
      }
    }
  })

  it('une demande extrême (des milliers de radians vers le haut) reste exploitable par lookAt', () => {
    const camera = orbitCamera(DEFAULT_CAMERA, 12345, 9999)
    expect(isSane(camera)).toBe(true)
    expect(() => lookAt(cameraPosition(camera), CAMERA_TARGET, CAMERA_UP)).not.toThrow()
  })

  it('sans la borne, le pôle exact ferait bien échouer lookAt (c\'est elle qui nous protège)', () => {
    const atPole = cameraPosition({ azimuth: 0, elevation: Math.PI / 2, distance: 5 })
    expect(() => lookAt(atPole, CAMERA_TARGET, CAMERA_UP)).toThrow(RangeError)
  })

  it('la caméra regarde bien l\'origine : l\'origine est devant, à la distance de la caméra', () => {
    const camera = { azimuth: 0.8, elevation: 0.6, distance: 7 }
    const view = lookAt(cameraPosition(camera), CAMERA_TARGET, CAMERA_UP)
    // L'origine dans le repère de la caméra : la dernière colonne de la matrice de vue.
    expect(view[12]).toBeCloseTo(0)
    expect(view[13]).toBeCloseTo(0)
    expect(view[14]).toBeCloseTo(-7) // devant la caméra (le regard va vers -Z), à 7 unités
  })
})
