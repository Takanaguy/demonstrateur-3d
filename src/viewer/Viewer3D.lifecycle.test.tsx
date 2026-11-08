import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { BoxGeometry, Mesh, MeshStandardMaterial, type PerspectiveCamera, type Scene } from 'three'
import { Viewer3D } from './Viewer3D'

// On remplace seulement le renderer (il a besoin de WebGL, absent de jsdom). Tout le reste de
// Three.js est réel : la scène, le cube, la géométrie et le matériau sont de vrais objets, dont
// on surveille la libération.
const rendererMock = vi.hoisted(() => ({
  instances: [] as {
    render: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    setPixelRatio: ReturnType<typeof vi.fn>
    setSize: ReturnType<typeof vi.fn>
  }[],
  failOnCreate: false,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeRenderer {
    render = vi.fn()
    dispose = vi.fn()
    setPixelRatio = vi.fn()
    setSize = vi.fn()
    constructor() {
      if (rendererMock.failOnCreate) throw new Error('Error creating WebGL context.')
      rendererMock.instances.push(this)
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer }
})

// La détection est testée à part (core/webgl.test.ts) : ici on veut le chemin « WebGL présent ».
vi.mock('../core/webgl', () => ({ isWebGLAvailable: () => true }))

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

/** Retrouve le cube dans la scène passée au renderer. */
function findCube(renderer: (typeof rendererMock.instances)[number]): Mesh {
  const scene = renderer.render.mock.calls[0]?.[0] as Scene
  const cube = scene.children.find((child): child is Mesh => child instanceof Mesh)
  if (!cube) throw new Error('cube introuvable dans la scène')
  return cube
}

beforeEach(() => {
  rendererMock.instances.length = 0
  rendererMock.failOnCreate = false
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

describe('Viewer3D : nettoyage au démontage', () => {
  it("libère le renderer, la géométrie et le matériau, et arrête l'animation", () => {
    const geometryDispose = vi.spyOn(BoxGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(MeshStandardMaterial.prototype, 'dispose')

    const { unmount } = render(<Viewer3D />)
    const renderer = rendererMock.instances[0]!
    runFrame(0) // une image rendue : l'animation a démarré et une suivante est en attente
    const pendingFrameId = [...frameCallbacks.keys()][0]!

    expect(renderer.dispose).not.toHaveBeenCalled()
    unmount()

    expect(renderer.dispose).toHaveBeenCalledOnce()
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(pendingFrameId)
    expect(frameCallbacks.size).toBe(0) // plus aucune image en attente : la boucle est bien morte
    expect(observerDisconnect).toHaveBeenCalledOnce()
  })

  it('en StrictMode, le premier montage est entièrement nettoyé avant le second', () => {
    const { container, unmount } = render(
      <StrictMode>
        <Viewer3D />
      </StrictMode>,
    )

    // React a monté, démonté puis remonté : deux renderers créés, le premier libéré.
    expect(rendererMock.instances).toHaveLength(2)
    expect(rendererMock.instances[0]!.dispose).toHaveBeenCalledOnce()
    expect(rendererMock.instances[1]!.dispose).not.toHaveBeenCalled()
    // Une seule boucle vivante (celle du second montage) et un seul canvas dans la page.
    expect(frameCallbacks.size).toBe(1)
    expect(container.querySelectorAll('canvas')).toHaveLength(1)

    unmount()
    expect(rendererMock.instances[1]!.dispose).toHaveBeenCalledOnce()
    expect(frameCallbacks.size).toBe(0)
  })
})

describe('Viewer3D : échec de création du renderer', () => {
  it('affiche le message de repli au lieu de planter, et ne lance aucune animation', () => {
    rendererMock.failOnCreate = true

    const { container } = render(<Viewer3D />)

    expect(screen.getByRole('status')).toHaveTextContent(/La 3D n'est pas disponible/)
    expect(container.querySelector('canvas')).toBeNull()
    expect(frameCallbacks.size).toBe(0)
  })
})

describe('Viewer3D : rotation et prefers-reduced-motion', () => {
  it('fait tourner le cube quand le mouvement est autorisé', () => {
    render(<Viewer3D />)
    runFrame(0)
    const cube = findCube(rendererMock.instances[0]!)
    const before = cube.rotation.y

    runFrame(50)

    expect(cube.rotation.y).toBeGreaterThan(before)
  })

  it("ne fait pas tourner le cube quand l'utilisateur demande moins de mouvement", () => {
    stubReducedMotion(true)
    render(<Viewer3D />)
    runFrame(0)
    const cube = findCube(rendererMock.instances[0]!)
    const before = cube.rotation.y

    runFrame(50)
    runFrame(100)

    expect(cube.rotation.y).toBe(before)
    // La scène est tout de même dessinée à chaque image : le cube est visible, simplement fixe.
    expect(rendererMock.instances[0]!.render).toHaveBeenCalledTimes(3)
  })
})

describe("Viewer3D : mouvement réduit modifié pendant l'exécution", () => {
  it("s'arrête puis reprend quand le réglage système change sans remonter le composant", () => {
    // La requête est la même, seul `matches` change : c'est ce que fait le navigateur.
    const query = { matches: false }
    vi.stubGlobal('matchMedia', () => query)
    render(<Viewer3D />)
    runFrame(0)
    const cube = findCube(rendererMock.instances[0]!)

    runFrame(50)
    const afterFirstTurn = cube.rotation.y
    expect(afterFirstTurn).toBeGreaterThan(0)

    query.matches = true
    runFrame(100)
    expect(cube.rotation.y).toBe(afterFirstTurn)

    query.matches = false
    runFrame(150)
    expect(cube.rotation.y).toBeGreaterThan(afterFirstTurn)
  })
})

describe('Viewer3D : taille et redimensionnement', () => {
  it('donne au canvas une taille CSS par défaut, pour que Three.js ne le fasse pas grossir', () => {
    const { container } = render(<Viewer3D />)
    const canvas = container.querySelector('canvas')!

    expect(canvas).toHaveClass('block', 'h-full', 'w-full')
  })

  it("remplace la taille par défaut par celle de l'appelant au lieu de les cumuler", () => {
    const { container } = render(<Viewer3D className="aspect-video w-full" />)
    const canvas = container.querySelector('canvas')!

    expect(canvas).toHaveClass('block', 'aspect-video', 'w-full')
    expect(canvas).not.toHaveClass('h-full')
  })

  it('adapte le renderer et la caméra à la taille mesurée du canvas', () => {
    const { container } = render(<Viewer3D />)
    const canvas = container.querySelector('canvas')!
    const renderer = rendererMock.instances[0]!
    runFrame(0)
    const camera = renderer.render.mock.calls[0]![1] as PerspectiveCamera
    renderer.setSize.mockClear()

    stubCanvasSize(canvas, 800, 400)
    fireResize()

    // `false` : Three.js ne doit pas écrire le style CSS du canvas, la mise en page s'en charge.
    expect(renderer.setSize).toHaveBeenCalledExactlyOnceWith(800, 400, false)
    expect(camera.aspect).toBe(2)
  })

  it('plafonne le ratio de pixels à 2', () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const { container } = render(<Viewer3D />)
    const renderer = rendererMock.instances[0]!
    stubCanvasSize(container.querySelector('canvas')!, 100, 100)

    fireResize()

    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2)
  })

  it('ignore une taille nulle, sans toucher au renderer ni à la caméra', () => {
    const { container } = render(<Viewer3D />)
    const canvas = container.querySelector('canvas')!
    const renderer = rendererMock.instances[0]!
    runFrame(0)
    const camera = renderer.render.mock.calls[0]![1] as PerspectiveCamera
    const aspectBefore = camera.aspect
    renderer.setSize.mockClear()

    stubCanvasSize(canvas, 0, 300)
    fireResize()
    stubCanvasSize(canvas, 300, 0)
    fireResize()

    expect(renderer.setSize).not.toHaveBeenCalled()
    expect(camera.aspect).toBe(aspectBefore)
  })
})

describe('Viewer3D : démontage avant la première image', () => {
  it("annule l'image en attente : rien n'est dessiné et la boucle ne repart pas", () => {
    const { unmount } = render(<Viewer3D />)
    const renderer = rendererMock.instances[0]!
    const pendingFrameId = [...frameCallbacks.keys()][0]!

    expect(() => unmount()).not.toThrow()

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(pendingFrameId)
    expect(frameCallbacks.size).toBe(0)
    expect(renderer.render).not.toHaveBeenCalled()
    expect(renderer.dispose).toHaveBeenCalledOnce()
  })
})
