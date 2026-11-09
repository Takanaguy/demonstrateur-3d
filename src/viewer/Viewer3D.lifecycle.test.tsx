import { act, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { SHADER_LOG, createFakeGl, type FakeGl, type FakeGlOptions } from '../test/fakeGl'
import { Viewer3D } from './Viewer3D'

// jsdom n'a pas de WebGL : `getContext('webgl2')` est remplacé par un faux contexte (voir
// test/fakeGl.ts) qui enregistre les appels et compte les ressources GPU encore vivantes. Les
// shaders, les maths et le composant sont les vrais ; seul le GPU est simulé.

/** Un faux contexte par canvas, comme le navigateur (même canvas = même contexte). */
let fakes: WeakMap<HTMLCanvasElement, FakeGl>
/** Les faux contextes des canvas de la page (pas celui, jetable, de la détection), dans l'ordre. */
let pageFakes: FakeGl[]
let fakeOptions: Omit<FakeGlOptions, 'size'>
/** Quand c'est vrai, le canvas de la page n'obtient pas de contexte (la détection, elle, réussit). */
let denyPageContext: boolean
let getContextSpy: ReturnType<typeof spyOnGetContext>

function spyOnGetContext() {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== 'webgl2') return null
    // Le canvas jetable de la détection n'est pas dans la page ; celui du composant, si.
    if (denyPageContext && this.isConnected) return null
    let fake = fakes.get(this)
    if (!fake) {
      // `size: this` : le tampon de dessin du faux contexte suit canvas.width / canvas.height.
      fake = createFakeGl({ ...fakeOptions, size: this })
      fakes.set(this, fake)
      if (this.isConnected) pageFakes.push(fake)
    }
    return fake.gl
  } as never)
}

// Boucle d'animation pilotée à la main : on décide quand chaque image « passe ».
let frameCallbacks: Map<number, FrameRequestCallback>
let nextFrameId: number
const cancelAnimationFrameMock = vi.fn((id: number) => {
  frameCallbacks.delete(id)
})
const observerDisconnect = vi.fn()
const observerObserve = vi.fn()
// Rappels des faux ResizeObserver créés : le test décide quand « le navigateur » signale un changement de taille.
let resizeCallbacks: ResizeObserverCallback[]

/** Joue l'image en attente, à l'instant `time` (en millisecondes). */
function runFrame(time: number) {
  const [id, callback] = [...frameCallbacks][0] ?? []
  if (id === undefined || !callback) throw new Error('aucune image en attente')
  frameCallbacks.delete(id)
  callback(time)
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
  }))
}

/** Fixe la taille que jsdom (qui ne fait pas de mise en page) devrait renvoyer pour le canvas. */
function stubCanvasSize(canvas: HTMLCanvasElement, width: number, height: number) {
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: height })
}

/** Simule le signal du ResizeObserver, comme après un changement de taille dans la page. */
function fireResize() {
  for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
}

/** Envoie un événement de contexte WebGL au canvas, et renvoie l'événement pour inspecter `defaultPrevented`. */
function dispatchContextEvent(canvas: HTMLCanvasElement, type: 'webglcontextlost' | 'webglcontextrestored') {
  const event = new Event(type, { cancelable: true })
  act(() => {
    canvas.dispatchEvent(event)
  })
  return event
}

/** Monte le composant et renvoie son canvas et son faux contexte. */
function mountViewer(props: { className?: string } = {}) {
  const view = render(<Viewer3D {...props} />)
  const canvas = view.container.querySelector('canvas')!
  return { ...view, canvas, fake: fakes.get(canvas)! }
}

const NOTHING_ALIVE = { shader: 0, program: 0, buffer: 0, vertexArray: 0 }
const ONE_CUBE_ALIVE = { shader: 0, program: 2, buffer: 3, vertexArray: 1 }

beforeEach(() => {
  fakes = new WeakMap()
  pageFakes = []
  fakeOptions = {}
  denyPageContext = false
  getContextSpy = spyOnGetContext()
  frameCallbacks = new Map()
  nextFrameId = 1
  resizeCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++
    frameCallbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }
      observe = observerObserve
      disconnect = observerDisconnect
      unobserve = vi.fn()
    },
  )
  stubReducedMotion(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  cancelAnimationFrameMock.mockClear()
  observerDisconnect.mockClear()
  observerObserve.mockClear()
})

describe('Viewer3D : création', () => {
  it('demande un contexte WebGL2 avec antialias et prépare le dessin', () => {
    const { canvas, fake } = mountViewer()

    expect(getContextSpy).toHaveBeenCalledWith('webgl2', { antialias: true })
    expect(fake.liveCounts()).toEqual(ONE_CUBE_ALIVE)
    expect(fake.mocks.enable).toHaveBeenCalledWith(fake.gl.DEPTH_TEST)
    expect(fake.mocks.enable).not.toHaveBeenCalledWith(fake.gl.CULL_FACE)
    // Un canvas qu'on manipule n'est plus une image : rôle « application », focusable au clavier.
    expect(canvas).toHaveAttribute('role', 'application')
    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas).toHaveAccessibleName(/objet en 3D/i)
  })

  it('dessine le cube à chaque image tant que le composant est monté', () => {
    const { fake } = mountViewer()

    runFrame(0)
    runFrame(16)

    expect(fake.mocks.drawElements).toHaveBeenCalledTimes(2)
    expect(frameCallbacks.size).toBe(1) // la suivante est déjà demandée
  })
})

describe('Viewer3D : nettoyage au démontage', () => {
  it("supprime programme, buffers et VAO, et arrête l'animation et les observateurs", () => {
    const { unmount, fake } = mountViewer()
    runFrame(0) // une image rendue : l'animation a démarré et une suivante est en attente
    const pendingFrameId = [...frameCallbacks.keys()][0]!

    expect(fake.liveCounts()).toEqual(ONE_CUBE_ALIVE)
    unmount()

    expect(fake.liveCounts()).toEqual(NOTHING_ALIVE)
    expect(fake.mocks.deleteProgram).toHaveBeenCalledTimes(2) // le programme de l'objet et celui des lignes
    expect(fake.mocks.deleteBuffer).toHaveBeenCalledTimes(3)
    expect(fake.mocks.deleteVertexArray).toHaveBeenCalledOnce()
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(pendingFrameId)
    expect(frameCallbacks.size).toBe(0) // plus aucune image en attente : la boucle est bien morte
    expect(observerDisconnect).toHaveBeenCalledOnce()
  })

  it('ne perd pas volontairement le contexte (le canvas est réutilisé par le second montage de StrictMode)', () => {
    const { unmount, fake } = mountViewer()

    unmount()

    // `loseContext` s'obtient via l'extension WEBGL_lose_context : elle ne doit jamais être demandée.
    expect(fake.mocks.getExtension).not.toHaveBeenCalled()
  })

  it('retire les écouteurs de contexte : un canvas démonté ne réagit plus', () => {
    const { unmount, canvas, fake } = mountViewer()
    unmount()
    const programsBefore = fake.mocks.createProgram.mock.calls.length

    const lost = dispatchContextEvent(canvas, 'webglcontextlost')
    dispatchContextEvent(canvas, 'webglcontextrestored')

    expect(lost.defaultPrevented).toBe(false)
    expect(fake.mocks.createProgram.mock.calls.length).toBe(programsBefore)
    expect(frameCallbacks.size).toBe(0)
  })

  it('en StrictMode, le premier montage est entièrement nettoyé avant le second', () => {
    const { container, unmount } = render(
      <StrictMode>
        <Viewer3D />
      </StrictMode>,
    )
    const canvas = container.querySelector('canvas')!
    const fake = fakes.get(canvas)!

    // React a monté, démonté puis remonté : deux jeux de ressources créés, un seul encore vivant.
    expect(fake.mocks.createProgram).toHaveBeenCalledTimes(4) // deux montages, deux programmes chacun (objet et lignes)
    expect(fake.mocks.deleteProgram).toHaveBeenCalledTimes(2) // les deux programmes du premier montage
    expect(fake.liveCounts()).toEqual(ONE_CUBE_ALIVE)
    // Une seule boucle vivante (celle du second montage) et un seul canvas dans la page.
    expect(frameCallbacks.size).toBe(1)
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
    expect(observerDisconnect).toHaveBeenCalledTimes(1)

    unmount()

    expect(fake.liveCounts()).toEqual(NOTHING_ALIVE)
    expect(frameCallbacks.size).toBe(0)
    // Aucun écouteur de contexte ne survit aux deux montages.
    expect(dispatchContextEvent(canvas, 'webglcontextlost').defaultPrevented).toBe(false)
  })

  it("démonté avant la première image : annule l'image en attente, rien n'est dessiné", () => {
    const { unmount, fake } = mountViewer()
    const pendingFrameId = [...frameCallbacks.keys()][0]!

    expect(() => unmount()).not.toThrow()

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(pendingFrameId)
    expect(frameCallbacks.size).toBe(0)
    expect(fake.mocks.drawElements).not.toHaveBeenCalled()
    expect(fake.liveCounts()).toEqual(NOTHING_ALIVE)
  })
})

describe('Viewer3D : échecs de création', () => {
  it('shader refusé : message de repli, rien ne reste alloué, le journal du compilateur va dans la console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeOptions = { failCompile: 'fragment' }

    const { container } = render(<Viewer3D />)

    expect(screen.getByRole('status')).toHaveTextContent(/La 3D n'est pas disponible/)
    expect(container.querySelector('canvas')).toBeNull()
    expect(frameCallbacks.size).toBe(0)
    expect(pageFakes[0]!.liveCounts()).toEqual(NOTHING_ALIVE) // le vertex shader déjà compilé a été libéré
    expect(consoleError).toHaveBeenCalledOnce()
    expect(consoleError.mock.calls[0]!.map(String).join(' ')).toContain(SHADER_LOG)
  })

  it('contexte refusé alors que la détection avait réussi : message de repli, pas de boucle', () => {
    denyPageContext = true

    const { container } = render(<Viewer3D />)

    expect(screen.getByRole('status')).toHaveTextContent(/La 3D n'est pas disponible/)
    expect(container.querySelector('canvas')).toBeNull()
    expect(frameCallbacks.size).toBe(0)
  })
})

describe('Viewer3D : perte et restauration du contexte', () => {
  it('à la perte : appelle preventDefault (pour autoriser la restauration) et arrête la boucle', () => {
    const { canvas } = mountViewer()
    runFrame(0)
    expect(frameCallbacks.size).toBe(1)

    const lost = dispatchContextEvent(canvas, 'webglcontextlost')

    expect(lost.defaultPrevented).toBe(true)
    expect(frameCallbacks.size).toBe(0)
  })

  it('à la restauration : recrée les ressources et relance la boucle de dessin', () => {
    const { canvas, fake } = mountViewer()
    runFrame(0)
    dispatchContextEvent(canvas, 'webglcontextlost')
    fake.loseAllResources() // le GPU a tout détruit, sans qu'aucun delete* ait été appelé
    expect(fake.liveCounts()).toEqual(NOTHING_ALIVE)
    const drawsBefore = fake.mocks.drawElements.mock.calls.length

    dispatchContextEvent(canvas, 'webglcontextrestored')

    expect(fake.mocks.createProgram).toHaveBeenCalledTimes(4) // les deux programmes du départ, puis les deux de la restauration
    expect(fake.liveCounts()).toEqual(ONE_CUBE_ALIVE)
    expect(frameCallbacks.size).toBe(1)
    runFrame(100)
    expect(fake.mocks.drawElements.mock.calls.length).toBe(drawsBefore + 1)
  })

  it('un redimensionnement pendant la perte ne plante pas ; la taille est reprise à la restauration', () => {
    const { canvas, fake } = mountViewer()
    runFrame(0)
    dispatchContextEvent(canvas, 'webglcontextlost')
    fake.loseAllResources()

    stubCanvasSize(canvas, 400, 200)
    expect(() => fireResize()).not.toThrow()
    expect(fake.mocks.viewport).not.toHaveBeenCalled()

    dispatchContextEvent(canvas, 'webglcontextrestored')
    expect(fake.mocks.viewport).toHaveBeenLastCalledWith(0, 0, 400, 200)
  })

  it('démonté pendant la perte : ne supprime rien (déjà détruit) et ne plante pas', () => {
    const { canvas, unmount, fake } = mountViewer()
    dispatchContextEvent(canvas, 'webglcontextlost')
    fake.loseAllResources()

    expect(() => unmount()).not.toThrow()

    expect(fake.mocks.deleteBuffer).not.toHaveBeenCalled()
    expect(fake.mocks.deleteProgram).not.toHaveBeenCalled()
    expect(frameCallbacks.size).toBe(0)
  })

  it('restauration impossible (shaders refusés au retour) : bascule sur le message de repli', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { canvas, fake } = mountViewer()
    dispatchContextEvent(canvas, 'webglcontextlost')
    fake.loseAllResources()
    fake.mocks.getShaderParameter.mockReturnValue(false)

    dispatchContextEvent(canvas, 'webglcontextrestored')

    expect(screen.getByRole('status')).toHaveTextContent(/La 3D n'est pas disponible/)
    expect(consoleError).toHaveBeenCalled()
    expect(frameCallbacks.size).toBe(0)
  })

  it("reprend à la même rotation après restauration, sans saut dû au temps passé pendant la perte", () => {
    const { canvas, fake } = mountViewer()
    runFrame(0)
    runFrame(100)
    const modelBefore = fake.lastUniform('uModel')
    dispatchContextEvent(canvas, 'webglcontextlost')
    fake.loseAllResources()
    dispatchContextEvent(canvas, 'webglcontextrestored')

    runFrame(5000) // 5 secondes ont passé : la rotation ne doit pas avancer d'un coup

    expect(fake.lastUniform('uModel')).toEqual(modelBefore)
  })
})

describe('Viewer3D : rotation et prefers-reduced-motion', () => {
  it('fait tourner le cube quand le mouvement est autorisé', () => {
    const { fake } = mountViewer()
    runFrame(0)
    const before = fake.lastUniform('uModel')

    runFrame(50)

    expect(fake.lastUniform('uModel')).not.toEqual(before)
  })

  it("ne fait pas tourner le cube quand l'utilisateur demande moins de mouvement", () => {
    stubReducedMotion(true)
    const { fake } = mountViewer()
    runFrame(0)
    const before = fake.lastUniform('uModel')

    runFrame(50)
    runFrame(100)

    expect(fake.lastUniform('uModel')).toEqual(before)
    // La scène est tout de même dessinée à chaque image : le cube est visible, simplement fixe.
    expect(fake.mocks.drawElements).toHaveBeenCalledTimes(3)
  })

  it("s'arrête puis reprend quand le réglage système change sans remonter le composant", () => {
    // La requête est la même, seul `matches` change : c'est ce que fait le navigateur.
    const query = { matches: false }
    vi.stubGlobal('matchMedia', () => query)
    const { fake } = mountViewer()
    runFrame(0)
    const firstModel = fake.lastUniform('uModel')

    runFrame(50)
    const afterFirstTurn = fake.lastUniform('uModel')
    expect(afterFirstTurn).not.toEqual(firstModel)

    query.matches = true
    runFrame(100)
    expect(fake.lastUniform('uModel')).toEqual(afterFirstTurn)

    query.matches = false
    runFrame(150)
    expect(fake.lastUniform('uModel')).not.toEqual(afterFirstTurn)
  })
})

describe('Viewer3D : taille et redimensionnement', () => {
  it('donne au canvas une taille CSS par défaut, pour que son contenu ne le fasse pas grossir', () => {
    const { canvas } = mountViewer()

    expect(canvas).toHaveClass('block', 'h-full', 'w-full')
  })

  it("remplace la taille par défaut par celle de l'appelant au lieu de les cumuler", () => {
    const { canvas } = mountViewer({ className: 'aspect-video w-full' })

    expect(canvas).toHaveClass('block', 'aspect-video', 'w-full')
    expect(canvas).not.toHaveClass('h-full')
  })

  it('adapte la résolution du canvas, le viewport et la projection à la taille mesurée', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const { canvas, fake } = mountViewer()

    stubCanvasSize(canvas, 800, 400)
    fireResize()

    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(400)
    expect(fake.mocks.viewport).toHaveBeenLastCalledWith(0, 0, 800, 400)
    const projection = fake.lastUniform('uProjection')!
    expect(projection[5]! / projection[0]!).toBeCloseTo(2) // aspect = 800 / 400
  })

  it('multiplie par le ratio de pixels pour rester net sur un écran dense', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const { canvas, fake } = mountViewer()

    stubCanvasSize(canvas, 300, 200)
    fireResize()

    expect([canvas.width, canvas.height]).toEqual([600, 400])
    expect(fake.mocks.viewport).toHaveBeenLastCalledWith(0, 0, 600, 400)
  })

  it('plafonne le ratio de pixels à 2', () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const { canvas } = mountViewer()

    stubCanvasSize(canvas, 100, 100)
    fireResize()

    expect(canvas.width).toBe(200)
  })

  it('prend la taille déjà mesurée dès le montage, avant tout redimensionnement', () => {
    // Le canvas a déjà une taille quand l'effet démarre (cas d'un parent déjà mis en page).
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(480)
    vi.stubGlobal('devicePixelRatio', 1)

    const { fake } = mountViewer()

    expect(fake.mocks.viewport).toHaveBeenCalledWith(0, 0, 640, 480)
  })

  it("n'écrit pas width et height quand la taille ne change pas (écrire efface le canvas)", () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const { canvas, fake } = mountViewer()
    stubCanvasSize(canvas, 800, 400)
    fireResize()

    // Espions sur l'instance : chaque ÉCRITURE de width ou height est comptée (la lecture reste normale).
    const writes = { width: 0, height: 0 }
    for (const key of ['width', 'height'] as const) {
      let value = canvas[key]
      Object.defineProperty(canvas, key, {
        configurable: true,
        get: () => value,
        set: (next: number) => {
          writes[key]++
          value = next
        },
      })
    }
    const viewportCalls = fake.mocks.viewport.mock.calls.length

    fireResize() // même taille que la précédente

    expect(writes).toEqual({ width: 0, height: 0 })
    // Le viewport est quand même remis à jour (inoffensif), seul l'effacement du canvas est évité.
    expect(fake.mocks.viewport.mock.calls.length).toBe(viewportCalls + 1)

    // Contrôle des espions : une vraie nouvelle taille, elle, est bien écrite.
    stubCanvasSize(canvas, 900, 450)
    fireResize()
    expect(writes).toEqual({ width: 1, height: 1 })
  })

  it('ignore une taille nulle, sans toucher au viewport, à la projection ni au canvas', () => {
    const { canvas, fake } = mountViewer()
    const projectionCalls = fake.uniformHistory('uProjection').length
    const widthBefore = canvas.width

    stubCanvasSize(canvas, 0, 300)
    fireResize()
    stubCanvasSize(canvas, 300, 0)
    fireResize()

    expect(fake.mocks.viewport).not.toHaveBeenCalled()
    expect(fake.uniformHistory('uProjection')).toHaveLength(projectionCalls)
    expect(canvas.width).toBe(widthBefore)
  })
})
