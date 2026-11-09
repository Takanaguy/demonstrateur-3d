import { render } from '@testing-library/react'
import { DEFAULT_LIGHTING, type LightingSettings } from '../core/lighting'
import { installFakeWebGL } from '../test/installFakeWebGL'
import { Viewer3D } from './Viewer3D'

// Changer la prop `lighting` doit renvoyer les uniforms de la lumière SANS recréer le canvas, le
// contexte ni le programme. Après une perte de contexte, les DERNIERS réglages doivent revenir.

let env: ReturnType<typeof installFakeWebGL>

beforeEach(() => {
  env = installFakeWebGL()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const BLINN_PHONG: LightingSettings = { ...DEFAULT_LIGHTING, model: 'blinn-phong', position: [-4, 2, 6] }
const GAUSSIAN: LightingSettings = { ...DEFAULT_LIGHTING, model: 'gaussian', position: [1.5, -3, 8], ambient: 0.1 }

describe('Viewer3D : éclairage', () => {
  it("sans la prop, applique les réglages par défaut dès le montage", () => {
    render(<Viewer3D />)

    const fake = env.pageFake()
    expect(fake.lastUniform('uLightingModel')).toEqual([0])
    expect(fake.lastUniform('uLightPosition')).toEqual([3, 4, 5])
  })

  it('applique dès le montage les réglages donnés (sans les envoyer deux fois)', () => {
    render(<Viewer3D lighting={BLINN_PHONG} />)

    const fake = env.pageFake()
    expect(fake.lastUniform('uLightingModel')).toEqual([1])
    expect(fake.lastUniform('uLightPosition')).toEqual([-4, 2, 6])
    expect(fake.uniformHistory('uLightingModel')).toHaveLength(1)
  })

  it('changer la prop envoie les nouveaux réglages sans recréer le canvas, le contexte ni le programme', () => {
    const { rerender, container } = render(<Viewer3D lighting={DEFAULT_LIGHTING} />)
    const canvas = container.querySelector('canvas')!
    const fake = env.pageFake()
    const contextRequests = env.getContext.mock.calls.length

    rerender(<Viewer3D lighting={BLINN_PHONG} />)

    expect(fake.lastUniform('uLightingModel')).toEqual([1])
    expect(fake.lastUniform('uLightPosition')).toEqual([-4, 2, 6])
    expect(container.querySelector('canvas')).toBe(canvas)
    expect(env.getContext.mock.calls.length).toBe(contextRequests)
    expect(fake.mocks.createProgram).toHaveBeenCalledOnce()
    expect(fake.mocks.createVertexArray).toHaveBeenCalledOnce() // le maillage n'est pas renvoyé
    expect(fake.liveCounts()).toEqual({ shader: 0, program: 1, buffer: 3, vertexArray: 1 })
  })

  it('un nouveau rendu avec les MÊMES réglages ne les renvoie pas au GPU', () => {
    const { rerender } = render(<Viewer3D lighting={BLINN_PHONG} label="a" />)
    const fake = env.pageFake()
    const sent = fake.uniformHistory('uLightPosition').length

    rerender(<Viewer3D lighting={BLINN_PHONG} label="b" />)

    expect(fake.uniformHistory('uLightPosition')).toHaveLength(sent)
  })

  it('après une perte de contexte, réapplique les DERNIERS réglages (pas ceux du montage)', () => {
    const { rerender, container } = render(<Viewer3D lighting={DEFAULT_LIGHTING} />)
    const fake = env.pageFake()
    rerender(<Viewer3D lighting={BLINN_PHONG} />)
    rerender(<Viewer3D lighting={GAUSSIAN} />)
    const sentBefore = fake.uniformHistory('uLightPosition').length

    env.loseAndRestoreContext(container.querySelector('canvas')!, fake)

    expect(fake.mocks.createProgram).toHaveBeenCalledTimes(2)
    expect(fake.uniformHistory('uLightPosition').length).toBeGreaterThan(sentBefore)
    expect(fake.lastUniform('uLightingModel')).toEqual([2])
    expect(fake.lastUniform('uLightPosition')).toEqual([1.5, -3, 8])
    expect(fake.lastUniform('uAmbient')).toEqual([0.1])
  })

  it('des réglages choisis PENDANT la perte de contexte sont ceux qui reviennent à la restauration', () => {
    const { rerender, container } = render(<Viewer3D lighting={DEFAULT_LIGHTING} />)
    const fake = env.pageFake()
    const canvas = container.querySelector('canvas')!
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    fake.loseAllResources()

    expect(() => rerender(<Viewer3D lighting={BLINN_PHONG} />)).not.toThrow() // pas de renderer : on retient seulement
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    expect(fake.lastUniform('uLightingModel')).toEqual([1])
    expect(fake.lastUniform('uLightPosition')).toEqual([-4, 2, 6])
  })

  it('en démontant, ne laisse rien de vivant côté GPU', () => {
    const { rerender, unmount } = render(<Viewer3D />)
    const fake = env.pageFake()
    rerender(<Viewer3D lighting={GAUSSIAN} />)

    unmount()

    expect(fake.liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})
