import { render } from '@testing-library/react'
import { createShape } from '../core/shapes'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
import { installFakeWebGL } from '../test/installFakeWebGL'
import { Viewer3D } from './Viewer3D'

// Le fil de fer et les aides, vus depuis le composant : les options arrivent par la prop `viewOptions`,
// sont appliquées sans recréer le contexte, et une erreur de création d'aide remonte par `onOverlayError`.

let env: ReturnType<typeof installFakeWebGL>

beforeEach(() => {
  env = installFakeWebGL()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const WIREFRAME: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, displayMode: 'wireframe' }
const BOTH: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, displayMode: 'solid-wireframe' }
const NOTHING_ALIVE = { shader: 0, program: 0, buffer: 0, vertexArray: 0 }
const OUT_OF_MEMORY = 1285

let frameTime = 0
beforeEach(() => {
  frameTime = 0
})
/** Joue une image d'animation : c'est là que les aides sont créées et dessinées. */
function frame() {
  frameTime += 16
  env.runFrame(frameTime)
}

/** Les dessins faits depuis le dernier appel (le faux contexte garde la liste, on la vide ensuite). */
function drawsSinceLast() {
  const fake = env.pageFake()
  const draws = fake.draws().map((call) => [call.call, call.count] as const)
  fake.clearDraws()
  return draws
}

describe('Viewer3D : fil de fer et aides', () => {
  it('par défaut : seulement l\'objet plein, aucun trait', () => {
    render(<Viewer3D />)

    frame()

    expect(drawsSinceLast()).toEqual([['drawElements', 36]])
  })

  it('une option de fil de fer donnée au départ est appliquée dès la première image', () => {
    render(<Viewer3D viewOptions={WIREFRAME} />)

    frame()

    expect(drawsSinceLast()).toEqual([['drawArrays', 36]]) // les 18 arêtes du cube, sans remplissage
  })

  it('changer la prop passe en fil de fer, puis en plein et fil de fer, sans recréer le canvas, le contexte ni les programmes', () => {
    const { rerender, container } = render(<Viewer3D />)
    const canvas = container.querySelector('canvas')
    const contexts = env.getContext.mock.calls.length
    const fake = env.pageFake()
    frame()
    drawsSinceLast()

    rerender(<Viewer3D viewOptions={WIREFRAME} />)
    frame()
    expect(drawsSinceLast()).toEqual([['drawArrays', 36]])

    rerender(<Viewer3D viewOptions={BOTH} />)
    frame()
    expect(drawsSinceLast()).toEqual([
      ['drawElements', 36],
      ['drawArrays', 36],
    ])

    expect(container.querySelector('canvas')).toBe(canvas)
    expect(env.getContext.mock.calls.length).toBe(contexts)
    expect(fake.mocks.createProgram).toHaveBeenCalledTimes(2) // l'objet et les lignes, une fois
  })

  it('cocher les aides une par une les fait apparaître', () => {
    const { rerender } = render(<Viewer3D />)
    frame()
    drawsSinceLast()

    rerender(<Viewer3D viewOptions={{ ...DEFAULT_VIEW_OPTIONS, showNormals: true }} />)
    frame()
    expect(drawsSinceLast()).toEqual([
      ['drawElements', 36],
      ['drawArrays', 48],
    ])

    rerender(<Viewer3D viewOptions={{ ...DEFAULT_VIEW_OPTIONS, showBoundingBox: true, showGrid: true, showAxes: true }} />)
    frame()
    expect(drawsSinceLast()).toEqual([
      ['drawElements', 36],
      ['drawArrays', 24],
      ['drawArrays', 52],
      ['drawArrays', 2],
      ['drawArrays', 2],
      ['drawArrays', 2],
    ])
  })

  it('un nouveau maillage en fil de fer : les arêtes du nouveau sont dessinées (le plan : 5 segments, 10 sommets)', () => {
    const { rerender } = render(<Viewer3D viewOptions={WIREFRAME} />)
    frame()
    drawsSinceLast()

    rerender(<Viewer3D mesh={createShape('plane')} viewOptions={WIREFRAME} />)
    frame()

    expect(drawsSinceLast()).toEqual([['drawArrays', 10]]) // le plan : 5 segments
  })

  it('après une perte de contexte, les aides reviennent (le renderer recréé reçoit les options courantes)', () => {
    const { container } = render(<Viewer3D viewOptions={{ ...BOTH, showGrid: true }} />)
    const fake = env.pageFake()
    frame()
    drawsSinceLast()

    env.loseAndRestoreContext(container.querySelector('canvas')!, fake)
    expect(fake.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 }) // les séries viennent au premier dessin
    frame()

    expect(drawsSinceLast()).toEqual([
      ['drawElements', 36],
      ['drawArrays', 36],
      ['drawArrays', 52],
    ])
    expect(fake.isEnabled(fake.gl.POLYGON_OFFSET_FILL)).toBe(false)
  })

  it('le démontage libère aussi les séries de lignes', () => {
    const { unmount } = render(<Viewer3D viewOptions={{ ...BOTH, showNormals: true, showBoundingBox: true, showGrid: true, showAxes: true }} />)
    const fake = env.pageFake()
    frame()
    expect(fake.liveCounts().vertexArray).toBeGreaterThan(1)

    unmount()

    expect(fake.liveCounts()).toEqual(NOTHING_ALIVE)
  })
})

describe('Viewer3D : une aide ne peut pas être créée', () => {
  // Le cube fait les appels 1 à 3 à bufferData : les arêtes font le 4e, qui manque de mémoire GPU.
  beforeEach(() => {
    vi.unstubAllGlobals()
    env = installFakeWebGL({ bufferDataError: { call: 4, code: OUT_OF_MEMORY } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('prévient l\'appelant avec l\'erreur et le repli (affichage plein), et dessine l\'objet plein à la place', () => {
    const onOverlayError = vi.fn()
    render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={onOverlayError} />)

    frame()

    expect(onOverlayError).toHaveBeenCalledOnce()
    expect(onOverlayError.mock.calls[0]![0]).toEqual(expect.objectContaining({ message: expect.stringMatching(/Mémoire graphique/) }))
    expect(onOverlayError.mock.calls[0]![1]).toEqual({ displayMode: 'solid' })
    expect(drawsSinceLast()).toEqual([['drawElements', 36]])
    expect(env.pageFake().liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('journalise l\'erreur dans la console', () => {
    render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={vi.fn()} />)

    frame()

    expect(console.error).toHaveBeenCalled()
  })

  it('la boucle d\'animation continue : l\'erreur ne la tue pas', () => {
    render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={vi.fn()} />)

    frame()

    expect(env.pendingFrames()).toBe(1)
    frame()
    expect(drawsSinceLast().filter(([call]) => call === 'drawElements')).toHaveLength(2)
  })

  it('appelle le DERNIER rappel donné par l\'appelant, pas celui du premier rendu', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={first} />)

    rerender(<Viewer3D viewOptions={WIREFRAME} onOverlayError={second} />)
    frame()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('fonctionne sans rappel (rien ne plante, le repli a lieu)', () => {
    render(<Viewer3D viewOptions={WIREFRAME} />)

    expect(() => frame()).not.toThrow()

    expect(drawsSinceLast()).toEqual([['drawElements', 36]])
  })

  it('après le repli, une perte de contexte ne redemande pas le fil de fer (le repli est retenu)', () => {
    const onOverlayError = vi.fn()
    const { container } = render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={onOverlayError} />)
    const fake = env.pageFake()
    frame()
    drawsSinceLast()

    env.loseAndRestoreContext(container.querySelector('canvas')!, fake)
    frame()

    // Un 2e essai de création (appel 5 à bufferData) aurait réussi : si le fil de fer revenait, on verrait des traits.
    expect(drawsSinceLast()).toEqual([['drawElements', 36]])
    expect(onOverlayError).toHaveBeenCalledOnce()
  })

  it('l\'appelant qui remet ses propres options en plein n\'est pas rappelé une 2e fois', () => {
    const onOverlayError = vi.fn()
    const { rerender } = render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={onOverlayError} />)
    frame()

    rerender(<Viewer3D viewOptions={{ ...WIREFRAME, displayMode: 'solid' }} onOverlayError={onOverlayError} />)
    frame()

    expect(onOverlayError).toHaveBeenCalledOnce()
    expect(drawsSinceLast().filter(([call]) => call === 'drawArrays')).toHaveLength(0)
  })

  it('choisir de nouveau le fil de fer après le repli réessaie (et le 2e essai réussit ici)', () => {
    const onOverlayError = vi.fn()
    const { rerender } = render(<Viewer3D viewOptions={WIREFRAME} onOverlayError={onOverlayError} />)
    frame()
    rerender(<Viewer3D viewOptions={{ ...WIREFRAME, displayMode: 'solid' }} onOverlayError={onOverlayError} />)
    frame()
    drawsSinceLast()

    rerender(<Viewer3D viewOptions={{ ...WIREFRAME }} onOverlayError={onOverlayError} />)
    frame()

    expect(drawsSinceLast()).toEqual([['drawArrays', 36]])
    expect(onOverlayError).toHaveBeenCalledOnce()
  })
})
