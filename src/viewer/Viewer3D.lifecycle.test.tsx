import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { BoxGeometry, Mesh, MeshStandardMaterial, type Scene } from 'three'
import { Viewer3D } from './Viewer3D'

// On remplace seulement le renderer (il a besoin de WebGL, absent de jsdom). Tout le reste de
// Three.js est réel : la scène, le cube, la géométrie et le matériau sont de vrais objets, dont
// on surveille la libération.
const rendererMock = vi.hoisted(() => ({
  instances: [] as { render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
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
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++
    frameCallbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)
  vi.stubGlobal(
    'ResizeObserver',
    class {
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
