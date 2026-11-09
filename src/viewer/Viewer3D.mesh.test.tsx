import { render } from '@testing-library/react'
import { normalizeToUnitBox } from '../core/mesh'
import { createShape } from '../core/shapes'
import { installFakeWebGL, lastUploadedMesh } from '../test/installFakeWebGL'
import { Viewer3D } from './Viewer3D'

// Changer la prop `mesh` doit remplacer le maillage affiché SANS recréer le canvas, le contexte
// WebGL ni le programme : seuls le VAO et les buffers sont remplacés.

let env: ReturnType<typeof installFakeWebGL>

beforeEach(() => {
  env = installFakeWebGL()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ONE_MESH_ALIVE = { shader: 0, program: 1, buffer: 3, vertexArray: 1 }

describe('Viewer3D : changement de maillage', () => {
  it('affiche par défaut un cube (24 sommets)', () => {
    render(<Viewer3D />)

    const sent = lastUploadedMesh(env.pageFake())
    expect(sent.positions).toHaveLength(24 * 3)
  })

  it('envoie le premier maillage une seule fois, au montage', () => {
    render(<Viewer3D mesh={createShape('sphere')} />)

    expect(env.pageFake().mocks.createVertexArray).toHaveBeenCalledOnce()
  })

  it('un nouveau maillage remplace l\'ancien sans recréer le canvas, le contexte ni le programme', () => {
    const { rerender, container } = render(<Viewer3D mesh={createShape('cube')} />)
    const canvas = container.querySelector('canvas')!
    const fake = env.pageFake()
    const contextRequests = env.getContext.mock.calls.length

    const sphere = createShape('sphere')
    rerender(<Viewer3D mesh={sphere} />)

    expect(container.querySelector('canvas')).toBe(canvas) // même élément
    expect(env.getContext.mock.calls.length).toBe(contextRequests) // aucun nouveau contexte demandé
    expect(fake.mocks.createProgram).toHaveBeenCalledOnce()
    expect(fake.liveCounts()).toEqual(ONE_MESH_ALIVE) // l'ancien VAO et ses buffers ont été libérés
    const expected = normalizeToUnitBox(sphere)
    expect(lastUploadedMesh(fake).positions).toEqual(Array.from(expected.positions))
  })

  it('un nouveau rendu avec le MÊME maillage ne le renvoie pas au GPU', () => {
    const mesh = createShape('cone')
    const { rerender } = render(<Viewer3D mesh={mesh} label="a" />)
    const fake = env.pageFake()

    rerender(<Viewer3D mesh={mesh} label="b" />)

    expect(fake.mocks.createVertexArray).toHaveBeenCalledOnce()
  })

  it('met à jour la description lue par les lecteurs d\'écran', () => {
    const { container, rerender } = render(<Viewer3D label="Un cube" />)

    rerender(<Viewer3D label="Une sphère" />)

    expect(container.querySelector('canvas')).toHaveAccessibleName('Une sphère')
  })

  it('après une perte de contexte, redessine le DERNIER maillage choisi (pas le premier)', () => {
    const { rerender, container } = render(<Viewer3D mesh={createShape('cube')} />)
    const fake = env.pageFake()
    const cone = createShape('cone')
    rerender(<Viewer3D mesh={cone} />)

    env.loseAndRestoreContext(container.querySelector('canvas')!, fake)

    expect(fake.mocks.createProgram).toHaveBeenCalledTimes(2)
    expect(fake.liveCounts()).toEqual(ONE_MESH_ALIVE)
    expect(lastUploadedMesh(fake).positions).toEqual(Array.from(normalizeToUnitBox(cone).positions))
  })

  it('un maillage choisi PENDANT la perte de contexte est celui qui revient à la restauration', () => {
    const { rerender, container } = render(<Viewer3D mesh={createShape('cube')} />)
    const fake = env.pageFake()
    const canvas = container.querySelector('canvas')!
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    fake.loseAllResources()
    const plane = createShape('plane')

    expect(() => rerender(<Viewer3D mesh={plane} />)).not.toThrow() // pas de renderer : rien n'est envoyé au GPU
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    expect(lastUploadedMesh(fake).positions).toEqual(Array.from(normalizeToUnitBox(plane).positions))
  })

  it('si le GPU refuse le nouveau maillage : prévient l\'appelant, garde l\'ancien affiché, ne plante pas', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onMeshError = vi.fn()
    const cube = createShape('cube')
    const { rerender } = render(<Viewer3D mesh={cube} onMeshError={onMeshError} />)
    const fake = env.pageFake()
    fake.mocks.createBuffer.mockReturnValue(null)

    rerender(<Viewer3D mesh={createShape('sphere')} onMeshError={onMeshError} />)

    expect(onMeshError).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalled()
    expect(fake.liveCounts()).toEqual(ONE_MESH_ALIVE) // l'ancien est toujours là
  })

  it('OUT_OF_MEMORY lu par getError : onMeshError reçoit l\'erreur et l\'ancien maillage reste intact', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.unstubAllGlobals() // le beforeEach a déjà installé un faux sans panne : on le remplace
    // Le cube fait les appels 1 à 3 à bufferData, la sphère les 4 à 6 : le 5e (normales) manque de mémoire GPU.
    env = installFakeWebGL({ bufferDataError: { call: 5, code: 1285 } })
    const onMeshError = vi.fn()
    const { rerender } = render(<Viewer3D mesh={createShape('cube')} onMeshError={onMeshError} />)
    const fake = env.pageFake()

    rerender(<Viewer3D mesh={createShape('sphere')} onMeshError={onMeshError} />)

    expect(onMeshError).toHaveBeenCalledOnce()
    expect(onMeshError.mock.calls[0]![0]).toEqual(expect.objectContaining({ message: expect.stringMatching(/Mémoire graphique/) }))
    expect(fake.liveCounts()).toEqual(ONE_MESH_ALIVE)
  })

  it('en démontant, libère le dernier maillage (et pas seulement le premier)', () => {
    const { rerender, unmount } = render(<Viewer3D mesh={createShape('cube')} />)
    const fake = env.pageFake()
    rerender(<Viewer3D mesh={createShape('sphere')} />)

    unmount()

    expect(fake.liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})
