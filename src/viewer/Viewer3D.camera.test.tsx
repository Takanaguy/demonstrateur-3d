import { fireEvent, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { DEFAULT_CAMERA, DISTANCE_RANGE, ELEVATION_RANGE, cameraPosition } from '../core/camera'
import { createShape } from '../core/shapes'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
import type { FakeGl } from '../test/fakeGl'
import { installFakeWebGL } from '../test/installFakeWebGL'
import { Viewer3D } from './Viewer3D'

// La caméra vit dans une référence du composant : les gestionnaires d'événements la modifient et la
// boucle de dessin la relit à chaque image. On ne peut donc la voir qu'à travers ce que le GPU reçoit
// (uniforms uView et uCameraPosition) après avoir joué une image avec `env.runFrame`.

let env: ReturnType<typeof installFakeWebGL>
/** `setPointerCapture` n'existe pas dans jsdom : on le remplace par un espion. */
let setPointerCapture: ReturnType<typeof vi.fn>

beforeEach(() => {
  env = installFakeWebGL()
  setPointerCapture = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: setPointerCapture })
})

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).setPointerCapture
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const CANVAS_WIDTH = 400

/** Monte le composant avec un canvas large de 400 pixels (jsdom ne fait pas de mise en page). */
function mount(props: Parameters<typeof Viewer3D>[0] = {}) {
  const view = render(<Viewer3D {...props} />)
  const canvas = view.container.querySelector('canvas')!
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: CANVAS_WIDTH })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 200 })
  return { ...view, canvas, fake: env.pageFake() }
}

let frameTime = 0
/** Joue une image d'animation (la caméra courante part alors au GPU) et renvoie la position de l'oeil. */
function eyeAfterFrame(fake: FakeGl) {
  frameTime += 16
  env.runFrame(frameTime)
  const [x, y, z] = fake.lastUniform('uCameraPosition')!
  return { x: x!, y: y!, z: z!, distance: Math.hypot(x!, y!, z!) }
}

beforeEach(() => {
  frameTime = 0
})

/** La position attendue de l'oeil pour des angles donnés. */
function expectedEye(azimuth: number, elevation: number, distance: number) {
  const [x, y, z] = cameraPosition({ azimuth, elevation, distance })
  return { x, y, z }
}

function expectEye(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 4)
  expect(actual.y).toBeCloseTo(expected.y, 4)
  expect(actual.z).toBeCloseTo(expected.z, 4)
}

// `buttons: 1` (bouton gauche, ou doigt en contact) par défaut : jsdom met 0, ce qui serait lu comme
// « plus aucun bouton enfoncé » et abandonnerait le glisser.
const down = (canvas: HTMLElement, init: PointerEventInit = {}) =>
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, ...init })
const move = (canvas: HTMLElement, init: PointerEventInit = {}) =>
  fireEvent.pointerMove(canvas, { pointerId: 1, buttons: 1, clientX: 100, clientY: 100, ...init })

describe('Viewer3D : caméra de départ', () => {
  it("le premier dessin utilise la caméra par défaut (azimut 0, élévation 0,4, distance 5)", () => {
    const { fake } = mount()

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
  })
})

describe('Viewer3D : glisser (souris ou doigt)', () => {
  it('glisser vers la droite de toute la largeur fait faire un tour : un quart de largeur, un quart de tour', () => {
    const { canvas, fake } = mount()

    down(canvas, { clientX: 100, clientY: 100 })
    move(canvas, { clientX: 200, clientY: 100 }) // 100 pixels sur 400 : un quart de tour

    // La caméra va vers la gauche (azimut -PI/2), l'élévation et la distance ne bougent pas.
    expectEye(eyeAfterFrame(fake), expectedEye(-Math.PI / 2, 0.4, 5))
  })

  it('glisser vers la gauche fait tourner la caméra dans l\'autre sens', () => {
    const { canvas, fake } = mount()

    down(canvas, { clientX: 300 })
    move(canvas, { clientX: 200 })

    expectEye(eyeAfterFrame(fake), expectedEye(Math.PI / 2, 0.4, 5))
  })

  it('glisser vers le bas fait monter la caméra (on voit davantage le dessus), sans changer l\'azimut', () => {
    const { canvas, fake } = mount()

    down(canvas, { clientY: 100 })
    move(canvas, { clientY: 140 }) // 40 pixels : 2 PI * 40 / 400 radians

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4 + (2 * Math.PI * 40) / CANVAS_WIDTH, 5))
  })

  it('les déplacements successifs s\'additionnent (chaque mouvement part de la position précédente)', () => {
    const { canvas, fake } = mount()

    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 150 })
    move(canvas, { clientX: 200 })
    move(canvas, { clientX: 250 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 150) / CANVAS_WIDTH, 0.4, 5))
  })

  it('capture le pointeur au début du glisser (pour suivre le doigt hors du canvas)', () => {
    const { canvas } = mount()

    down(canvas, { pointerId: 7 })

    expect(setPointerCapture).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('un mouvement sans appui préalable ne fait rien (survol simple)', () => {
    const { canvas, fake } = mount()

    move(canvas, { clientX: 300, clientY: 300 })

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
  })

  it('relâcher arrête le glisser : les mouvements suivants ne tournent plus', () => {
    const { canvas, fake } = mount()
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 150 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })

    move(canvas, { clientX: 300 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 50) / CANVAS_WIDTH, 0.4, 5))
  })

  it('pointercancel (geste interrompu par le système) arrête aussi le glisser', () => {
    const { canvas, fake } = mount()
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 150 })
    fireEvent.pointerCancel(canvas, { pointerId: 1 })

    move(canvas, { clientX: 300 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 50) / CANVAS_WIDTH, 0.4, 5))
  })

  it("pointermove sans bouton enfoncé (relâchement manqué hors de la fenêtre) abandonne le glisser, sans tourner", () => {
    const { canvas, fake } = mount()
    down(canvas, { clientX: 100 })

    move(canvas, { clientX: 300, buttons: 0 })

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
    // Le glisser est abandonné : les mouvements suivants, même avec un bouton, ne tournent plus.
    move(canvas, { clientX: 350, buttons: 1 })
    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
  })

  it('après un glisser abandonné faute de bouton, un nouveau pointerdown est accepté', () => {
    const { canvas, fake } = mount()
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 300, buttons: 0 })
    setPointerCapture.mockClear()

    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 200 })

    expect(setPointerCapture).toHaveBeenCalledOnce()
    expectEye(eyeAfterFrame(fake), expectedEye(-Math.PI / 2, 0.4, 5))
  })

  it('lostpointercapture (capture reprise par le navigateur) termine le glisser', () => {
    const { canvas, fake } = mount()
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 150 })
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 })

    move(canvas, { clientX: 300 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 50) / CANVAS_WIDTH, 0.4, 5))
    // Et un nouveau glisser peut commencer.
    setPointerCapture.mockClear()
    down(canvas, { clientX: 300 })
    expect(setPointerCapture).toHaveBeenCalledOnce()
  })

  it("lostpointercapture d'un autre pointeur ne termine pas le glisser en cours", () => {
    const { canvas, fake } = mount()
    down(canvas, { pointerId: 1, clientX: 100 })

    fireEvent.lostPointerCapture(canvas, { pointerId: 2 })
    move(canvas, { pointerId: 1, clientX: 150 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 50) / CANVAS_WIDTH, 0.4, 5))
  })

  it('on peut recommencer un nouveau glisser après avoir relâché, depuis le nouveau point de départ', () => {
    const { canvas, fake } = mount()
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 140 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })

    down(canvas, { clientX: 300 }) // un nouvel appui ailleurs : pas de saut vers cette position
    move(canvas, { clientX: 310 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 50) / CANVAS_WIDTH, 0.4, 5))
  })

  it('un second doigt (autre pointerId) est ignoré pendant un glisser : pas de pincement, pas de saut', () => {
    const { canvas, fake } = mount()
    down(canvas, { pointerId: 1, clientX: 100 })

    down(canvas, { pointerId: 2, clientX: 300 })
    move(canvas, { pointerId: 1, clientX: 150 })
    // Le mouvement du second doigt vient EN DERNIER : les écarts s'additionnent (la somme ne dépend que
    // du dernier point), un test qui le placerait avant ne verrait pas la différence.
    move(canvas, { pointerId: 2, clientX: 350 })

    expectEye(eyeAfterFrame(fake), expectedEye(-(2 * Math.PI * 50) / CANVAS_WIDTH, 0.4, 5))
    expect(setPointerCapture).toHaveBeenCalledOnce() // le second doigt n'a pas été capturé
  })

  it('ignore les boutons autres que le principal (clic droit, clic milieu)', () => {
    const { canvas, fake } = mount()

    down(canvas, { button: 2, buttons: 2 })
    move(canvas, { clientX: 300 })
    down(canvas, { button: 1, buttons: 4 })
    move(canvas, { clientX: 350 })

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
    expect(setPointerCapture).not.toHaveBeenCalled()
  })

  it("l'élévation s'arrête aux bornes : un très long glisser vers le haut ou le bas ne passe pas le pôle", () => {
    const { canvas, fake } = mount()

    down(canvas, { clientY: 0 })
    move(canvas, { clientY: 100000 })
    const high = eyeAfterFrame(fake)
    move(canvas, { clientY: -100000 })
    const low = eyeAfterFrame(fake)

    expect(high.y).toBeCloseTo(5 * Math.sin(ELEVATION_RANGE.max), 4)
    expect(low.y).toBeCloseTo(5 * Math.sin(ELEVATION_RANGE.min), 4)
  })

  it("un canvas sans largeur (pas encore mis en page) ne produit ni erreur ni NaN", () => {
    const { canvas, fake } = mount()
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 0 })

    down(canvas)
    expect(() => move(canvas, { clientX: 500 })).not.toThrow()

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
  })

  it("pendant qu'on glisse, la rotation automatique continue (l'objet tourne ET la caméra bouge)", () => {
    const { canvas, fake } = mount()
    env.runFrame(0)
    const before = fake.lastUniform('uModel')
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 150 })

    env.runFrame(100)

    expect(fake.lastUniform('uModel')).not.toEqual(before)
    const eye = fake.lastUniform('uCameraPosition')!
    expect(eye[0]).not.toBeCloseTo(0) // et la caméra est bien partie de côté
  })

  it("avec prefers-reduced-motion, l'objet ne tourne pas seul, mais la caméra obéit toujours à l'utilisateur", () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion') }))
    const { canvas, fake } = mount()
    env.runFrame(0)
    const modelBefore = fake.lastUniform('uModel')
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 200 })

    const eye = eyeAfterFrame(fake)

    expect(fake.lastUniform('uModel')).toEqual(modelBefore)
    expectEye(eye, expectedEye(-Math.PI / 2, 0.4, 5))
  })
})

describe('Viewer3D : molette', () => {
  it('un cran vers le bas (deltaY positif) éloigne la caméra, proportionnellement : distance x exp(0,1)', () => {
    const { canvas, fake } = mount()

    fireEvent.wheel(canvas, { deltaY: 100 })

    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 * Math.exp(0.1), 4)
  })

  it('un cran vers le haut (deltaY négatif) rapproche la caméra, et annule exactement un cran vers le bas', () => {
    const { canvas, fake } = mount()

    fireEvent.wheel(canvas, { deltaY: -100 })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 * Math.exp(-0.1), 4)
    fireEvent.wheel(canvas, { deltaY: 100 })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5, 4)
  })

  it('appelle preventDefault pour que la page ne défile pas pendant le zoom', () => {
    const { canvas } = mount()

    // fireEvent renvoie false quand l'événement a été annulé par preventDefault.
    expect(fireEvent.wheel(canvas, { deltaY: 100 })).toBe(false)
    expect(fireEvent.wheel(canvas, { deltaY: -100 })).toBe(false)
  })

  it('le zoom ne change ni l\'azimut ni l\'élévation (la direction du regard est la même)', () => {
    const { canvas, fake } = mount()

    fireEvent.wheel(canvas, { deltaY: 300 })

    const eye = eyeAfterFrame(fake)
    const direction = { x: eye.x / eye.distance, y: eye.y / eye.distance, z: eye.z / eye.distance }
    expectEye(direction, { x: 0, y: Math.sin(0.4), z: Math.cos(0.4) })
  })

  it('le zoom est borné : on ne peut ni traverser l\'objet ni s\'en aller sans fin', () => {
    const { canvas, fake } = mount()

    fireEvent.wheel(canvas, { deltaY: -100000 })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(DISTANCE_RANGE.min, 4)
    fireEvent.wheel(canvas, { deltaY: 100000 })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(DISTANCE_RANGE.max, 4)
  })

  it('compte une molette en « lignes » (Firefox) comme 16 pixels par ligne', () => {
    const { canvas, fake } = mount()

    fireEvent.wheel(canvas, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE })

    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 * Math.exp(3 * 16 * 0.001), 4)
  })

  it('compte une molette en « pages » comme 100 pixels par page', () => {
    const { canvas, fake } = mount()

    fireEvent.wheel(canvas, { deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_PAGE })

    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 * Math.exp(2 * 100 * 0.001), 4)
  })

  it('l\'écouteur de molette est ajouté NON passif (sinon preventDefault serait ignoré par le navigateur)', () => {
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener')

    mount()

    const wheelCalls = addSpy.mock.calls.filter(
      (call, i) => call[0] === 'wheel' && addSpy.mock.contexts[i] instanceof HTMLCanvasElement,
    )
    expect(wheelCalls).toHaveLength(1)
    expect(wheelCalls[0]![2]).toEqual({ passive: false })
  })
})

describe('Viewer3D : clavier', () => {
  it('le canvas est atteignable au clavier (tabindex 0) et décrit ses commandes (aria-describedby)', () => {
    const { canvas, container } = mount()

    expect(canvas).toHaveAttribute('tabindex', '0')
    const help = container.querySelector(`[id="${canvas.getAttribute('aria-describedby')}"]`)
    expect(help).not.toBeNull()
    expect(canvas).toHaveAccessibleDescription(/flèches/)
    expect(canvas).toHaveAccessibleDescription(/molette/)
    expect(canvas).toHaveAccessibleDescription(/plus et moins/)
  })

  it('le canvas peut recevoir le focus', () => {
    const { canvas } = mount()

    canvas.focus()

    expect(canvas).toHaveFocus()
  })

  it.each([
    ['ArrowLeft', 0.1, 0.4],
    ['ArrowRight', -0.1, 0.4],
    ['ArrowUp', 0, 0.3],
    ['ArrowDown', 0, 0.5],
  ])('%s tourne la caméra comme un glisser dans cette direction (pas de 0,1 rad)', (key, azimuth, elevation) => {
    const { canvas, fake } = mount()

    fireEvent.keyDown(canvas, { key })

    expectEye(eyeAfterFrame(fake), expectedEye(azimuth, elevation, 5))
  })

  it('maintenir une flèche (répétition de keydown) continue de tourner', () => {
    const { canvas, fake } = mount()

    for (let i = 0; i < 5; i++) fireEvent.keyDown(canvas, { key: 'ArrowLeft' })

    expectEye(eyeAfterFrame(fake), expectedEye(0.5, 0.4, 5))
  })

  it('+ rapproche de 10 %, - éloigne de 10 %', () => {
    const { canvas, fake } = mount()

    fireEvent.keyDown(canvas, { key: '+' })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 / 1.1, 4)
    fireEvent.keyDown(canvas, { key: '-' })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5, 4)
    fireEvent.keyDown(canvas, { key: '-' })
    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5.5, 4)
  })

  it('= (le + des claviers QWERTY sans Maj) zoome aussi', () => {
    const { canvas, fake } = mount()

    fireEvent.keyDown(canvas, { key: '=' })

    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 / 1.1, 4)
  })

  it('les touches utilisées sont annulées par preventDefault (sinon les flèches feraient défiler la page)', () => {
    const { canvas } = mount()

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-']) {
      expect(fireEvent.keyDown(canvas, { key }), key).toBe(false)
    }
  })

  it('les autres touches ne sont pas touchées (Tab doit toujours pouvoir quitter le canvas)', () => {
    const { canvas, fake } = mount()

    expect(fireEvent.keyDown(canvas, { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(canvas, { key: 'a' })).toBe(true)

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
  })

  it('Ctrl, Cmd ou Alt + « + » ou « - » (zoom du navigateur) ne sont pas volés', () => {
    const { canvas, fake } = mount()

    expect(fireEvent.keyDown(canvas, { key: '+', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(canvas, { key: '-', metaKey: true })).toBe(true)
    expect(fireEvent.keyDown(canvas, { key: 'ArrowLeft', altKey: true })).toBe(true) // Alt + flèche = navigation

    expectEye(eyeAfterFrame(fake), expectedEye(0, 0.4, 5))
  })

  it("l'élévation s'arrête aux bornes au clavier aussi", () => {
    const { canvas, fake } = mount()

    for (let i = 0; i < 100; i++) fireEvent.keyDown(canvas, { key: 'ArrowUp' })

    expect(eyeAfterFrame(fake).y).toBeCloseTo(5 * Math.sin(ELEVATION_RANGE.min), 4)
  })
})

describe('Viewer3D : réinitialisation de la caméra (resetViewKey)', () => {
  it('quand la clé change, la caméra revient à la position de départ', () => {
    const { canvas, fake, rerender } = mount({ resetViewKey: 0 })
    down(canvas, { clientX: 100 })
    move(canvas, { clientX: 250 })
    fireEvent.wheel(canvas, { deltaY: 400 })
    expect(eyeAfterFrame(fake).distance).not.toBeCloseTo(5)

    rerender(<Viewer3D resetViewKey={1} />)

    const [x, y, z] = cameraPosition(DEFAULT_CAMERA)
    expectEye(eyeAfterFrame(fake), { x, y, z })
  })

  it('un nouveau rendu avec la MÊME clé garde la caméra (seul un changement réinitialise)', () => {
    const { canvas, fake, rerender } = mount({ resetViewKey: 4 })
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })

    rerender(<Viewer3D resetViewKey={4} label="autre" />)

    expectEye(eyeAfterFrame(fake), expectedEye(0.1, 0.4, 5))
  })

  it('la valeur initiale de la clé ne réinitialise rien (même non nulle)', () => {
    const { canvas, fake } = mount({ resetViewKey: 9 })

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })

    expectEye(eyeAfterFrame(fake), expectedEye(0.1, 0.4, 5))
  })

  it('on peut tourner de nouveau après une réinitialisation, depuis la position de départ', () => {
    const { canvas, fake, rerender } = mount({ resetViewKey: 0 })
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    rerender(<Viewer3D resetViewKey={1} />)

    fireEvent.keyDown(canvas, { key: 'ArrowRight' })

    expectEye(eyeAfterFrame(fake), expectedEye(-0.1, 0.4, 5))
  })
})

describe('Viewer3D : la caméra survit aux changements de maillage', () => {
  it('changer de forme ne remet pas la caméra à sa place', () => {
    const { canvas, fake, rerender } = mount({ mesh: createShape('cube') })
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })

    rerender(<Viewer3D mesh={createShape('sphere')} />)

    expectEye(eyeAfterFrame(fake), expectedEye(0.1, 0.4, 5))
  })
})

describe('Viewer3D : options de vue', () => {
  const CULLING: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, backfaceCulling: true }
  const STILL: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, autoRotate: false }

  it('sans la prop : rotation automatique active, culling désactivé', () => {
    const { fake } = mount()
    env.runFrame(0)
    const before = fake.lastUniform('uModel')

    env.runFrame(50)

    expect(fake.lastUniform('uModel')).not.toEqual(before)
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(false)
  })

  it('autoRotate à false : l\'objet ne tourne plus, la scène est tout de même dessinée à chaque image', () => {
    const { fake } = mount({ viewOptions: STILL })
    env.runFrame(0)
    const before = fake.lastUniform('uModel')

    env.runFrame(50)
    env.runFrame(100)

    expect(fake.lastUniform('uModel')).toEqual(before)
    expect(fake.mocks.drawElements).toHaveBeenCalledTimes(3)
  })

  it('désactiver puis réactiver la rotation automatique : elle s\'arrête, puis reprend sans saut', () => {
    const { fake, rerender } = mount()
    env.runFrame(0)
    env.runFrame(50)
    const moving = fake.lastUniform('uModel')

    rerender(<Viewer3D viewOptions={STILL} />)
    env.runFrame(100)
    env.runFrame(3000) // longtemps après : toujours immobile
    expect(fake.lastUniform('uModel')).toEqual(moving)

    rerender(<Viewer3D viewOptions={DEFAULT_VIEW_OPTIONS} />)
    env.runFrame(3050)
    expect(fake.lastUniform('uModel')).not.toEqual(moving)
  })

  it('le culling est appliqué dès le montage quand il est demandé', () => {
    const { fake } = mount({ viewOptions: CULLING })

    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)
    expect(fake.cullFaceMode()).toBe(fake.gl.BACK)
  })

  it('changer la prop active puis désactive le culling, sans recréer le canvas, le contexte ni le programme', () => {
    const { container, canvas, fake, rerender } = mount()
    const contextRequests = env.getContext.mock.calls.length

    rerender(<Viewer3D viewOptions={CULLING} />)
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)
    rerender(<Viewer3D viewOptions={DEFAULT_VIEW_OPTIONS} />)
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(false)

    expect(container.querySelector('canvas')).toBe(canvas)
    expect(env.getContext.mock.calls.length).toBe(contextRequests)
    expect(fake.mocks.createProgram).toHaveBeenCalledTimes(2) // deux programmes : l'objet et les lignes
    expect(fake.mocks.createVertexArray).toHaveBeenCalledOnce()
  })

  it('un nouveau rendu avec les MÊMES options ne les renvoie pas au GPU', () => {
    const { fake, rerender } = mount({ viewOptions: CULLING })
    const enableCalls = fake.mocks.enable.mock.calls.length

    rerender(<Viewer3D viewOptions={CULLING} label="autre" />)

    expect(fake.mocks.enable.mock.calls.length).toBe(enableCalls)
  })

  it('après une perte de contexte, le culling choisi revient (le contexte restauré repart sans culling)', () => {
    const { canvas, fake, rerender } = mount()
    rerender(<Viewer3D viewOptions={CULLING} />)
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)

    env.loseAndRestoreContext(canvas, fake)

    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)
    expect(fake.cullFaceMode()).toBe(fake.gl.BACK)
  })

  it('des options choisies PENDANT la perte de contexte sont celles qui reviennent à la restauration', () => {
    const { canvas, fake, rerender } = mount()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    fake.loseAllResources()

    expect(() => rerender(<Viewer3D viewOptions={CULLING} />)).not.toThrow()
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)
  })

  it('après une perte de contexte, la rotation automatique désactivée le reste', () => {
    const { canvas, fake, rerender } = mount()
    rerender(<Viewer3D viewOptions={STILL} />)

    env.loseAndRestoreContext(canvas, fake)
    env.runFrame(0)
    const before = fake.lastUniform('uModel')
    env.runFrame(100)

    expect(fake.lastUniform('uModel')).toEqual(before)
  })
})

describe('Viewer3D : la caméra courante survit à une perte de contexte', () => {
  it('après perte et restauration, le renderer recréé reçoit la caméra COURANTE, pas celle de départ', () => {
    const { canvas, fake } = mount()
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    fireEvent.wheel(canvas, { deltaY: 100 })
    eyeAfterFrame(fake) // la caméra courante est celle qui est partie au GPU

    env.loseAndRestoreContext(canvas, fake)

    // Juste après la restauration, avant toute nouvelle image : la caméra est déjà celle de l'utilisateur.
    const [x, y, z] = fake.lastUniform('uCameraPosition')!
    expectEye({ x: x!, y: y!, z: z! }, expectedEye(0.1, 0.4, 5 * Math.exp(0.1)))
    expect(fake.uniformHistory('uView').at(-1)!.values).toHaveLength(16)
  })

  it('une caméra déplacée PENDANT la perte est retenue pour la restauration', () => {
    const { canvas, fake } = mount()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    fake.loseAllResources()

    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    const [x, y, z] = fake.lastUniform('uCameraPosition')!
    expectEye({ x: x!, y: y!, z: z! }, expectedEye(-0.1, 0.4, 5))
  })
})

describe('Viewer3D : nettoyage des écouteurs de la caméra', () => {
  it('retire au démontage chaque écouteur ajouté au canvas (pointeur, molette, clavier, contexte)', () => {
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const removeSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener')
    const { unmount } = mount()
    // Les écouteurs posés sur le canvas : type et fonction.
    const onCanvas = (spy: typeof addSpy) =>
      spy.mock.calls
        .map((call, i) => ({ type: call[0], listener: call[1], target: spy.mock.contexts[i] }))
        .filter((call) => call.target instanceof HTMLCanvasElement)
    const added = onCanvas(addSpy)
    expect(added.map((call) => call.type)).toEqual(
      expect.arrayContaining(['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'wheel', 'keydown']),
    )

    unmount()

    const removed = onCanvas(removeSpy)
    for (const call of added) {
      expect(
        removed.some((r) => r.type === call.type && r.listener === call.listener && r.target === call.target),
        `écouteur « ${call.type} » non retiré`,
      ).toBe(true)
    }
  })

  it('un canvas démonté ne réagit plus : plus de preventDefault sur la molette ni sur les touches', () => {
    const { canvas, unmount } = mount()
    expect(fireEvent.wheel(canvas, { deltaY: 100 })).toBe(false) // vivant : la molette est annulée

    unmount()

    expect(fireEvent.wheel(canvas, { deltaY: 100 })).toBe(true)
    expect(fireEvent.keyDown(canvas, { key: 'ArrowLeft' })).toBe(true)
    down(canvas)
    expect(setPointerCapture).not.toHaveBeenCalled()
  })

  it('en StrictMode (monté, démonté, remonté), la molette ne zoome qu\'une fois par cran (pas d\'écouteur en double)', () => {
    const view = render(
      <StrictMode>
        <Viewer3D />
      </StrictMode>,
    )
    const canvas = view.container.querySelector('canvas')!
    const fake = env.pageFake()

    fireEvent.wheel(canvas, { deltaY: 100 })

    expect(eyeAfterFrame(fake).distance).toBeCloseTo(5 * Math.exp(0.1), 4)
  })
})

describe('Viewer3D : accessibilité du canvas', () => {
  it('rôle application (et non img) : un canvas qu\'on manipule au clavier n\'est pas une image', () => {
    const { canvas } = mount({ label: 'Mon objet' })

    expect(canvas).toHaveAttribute('role', 'application')
    expect(canvas).toHaveAccessibleName('Mon objet')
  })

  it('ne laisse pas la page défiler sous le doigt : touch-action none (classe touch-none) même avec une className', () => {
    const { canvas } = mount({ className: 'aspect-video w-full' })

    // Test sur la présence de la classe : jsdom ne charge pas le CSS, on ne peut pas lire le style réel.
    expect(canvas).toHaveClass('touch-none', 'select-none', 'aspect-video')
  })

  it('un contour de focus visible est prévu pour la navigation au clavier', () => {
    const { canvas } = mount()

    expect(canvas.className).toMatch(/focus-visible:outline/)
  })
})
