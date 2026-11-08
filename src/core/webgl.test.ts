import { isWebGLAvailable } from './webgl'

/** Fabrique un faux canvas dont `getContext` renvoie ce qu'on lui donne. */
function fakeCanvas(getContext: (type: string) => unknown): () => HTMLCanvasElement {
  return () => ({ getContext }) as unknown as HTMLCanvasElement
}

describe('isWebGLAvailable', () => {
  it('renvoie false quand le navigateur ne fournit pas de contexte (null)', () => {
    expect(isWebGLAvailable(fakeCanvas(() => null))).toBe(false)
  })

  it('renvoie false quand getContext lève une exception, sans la laisser remonter', () => {
    const throwing = fakeCanvas(() => {
      throw new Error('contexte refusé')
    })
    expect(isWebGLAvailable(throwing)).toBe(false)
  })

  it('renvoie true quand un contexte WebGL 2 existe, et libère ce contexte de test', () => {
    const loseContext = vi.fn()
    const gl = { getExtension: vi.fn(() => ({ loseContext })) }
    const getContext = vi.fn(() => gl)

    expect(isWebGLAvailable(fakeCanvas(getContext))).toBe(true)
    expect(getContext).toHaveBeenCalledWith('webgl2')
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context')
    expect(loseContext).toHaveBeenCalledOnce()
  })

  it("renvoie true même si l'extension de libération est absente", () => {
    const gl = { getExtension: () => null }
    expect(isWebGLAvailable(fakeCanvas(() => gl))).toBe(true)
  })
})
