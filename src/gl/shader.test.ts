import { PROGRAM_LOG, SHADER_LOG, createFakeGl } from '../test/fakeGl'
import { createProgram, createShader } from './shader'

const VERT = 'void main() {}'
const FRAG = 'void main() {}'

describe('createShader', () => {
  it('envoie la source, la compile, et renvoie le shader', () => {
    const { gl, mocks, liveCounts } = createFakeGl()

    const shader = createShader(gl, gl.VERTEX_SHADER, VERT)

    expect(mocks.createShader).toHaveBeenCalledWith(gl.VERTEX_SHADER)
    expect(mocks.shaderSource).toHaveBeenCalledWith(shader, VERT)
    expect(mocks.compileShader).toHaveBeenCalledWith(shader)
    // L'ordre compte : on ne compile pas avant d'avoir donné la source.
    expect(mocks.shaderSource.mock.invocationCallOrder[0]).toBeLessThan(mocks.compileShader.mock.invocationCallOrder[0]!)
    expect(liveCounts().shader).toBe(1)
  })

  it('en cas d\'échec : lève une erreur en français avec le journal du compilateur, et libère le shader', () => {
    const { gl, mocks, liveCounts } = createFakeGl({ failCompile: 'fragment' })

    let error: Error | undefined
    try {
      createShader(gl, gl.FRAGMENT_SHADER, FRAG)
    } catch (e) {
      error = e as Error
    }

    expect(error?.message).toContain('compilation')
    expect(error?.message).toContain('fragments')
    expect(error?.message).toContain(SHADER_LOG)
    expect(mocks.deleteShader).toHaveBeenCalledOnce()
    expect(liveCounts().shader).toBe(0)
  })

  it('distingue le shader de sommets dans le message', () => {
    const { gl } = createFakeGl({ failCompile: 'vertex' })
    expect(() => createShader(gl, gl.VERTEX_SHADER, VERT)).toThrow(/sommets/)
  })

  it('lève une erreur claire si le contexte ne peut pas créer de shader (null)', () => {
    const { gl } = createFakeGl({ failCreate: 'shader' })
    expect(() => createShader(gl, gl.VERTEX_SHADER, VERT)).toThrow(/Impossible de créer le shader/)
  })
})

describe('createProgram', () => {
  it('compile les deux shaders, les attache, lie le programme, puis demande la suppression des shaders', () => {
    const { gl, mocks, liveCounts } = createFakeGl()

    const program = createProgram(gl, VERT, FRAG)

    expect(mocks.attachShader).toHaveBeenCalledTimes(2)
    expect(mocks.attachShader.mock.calls.every(([target]) => target === program)).toBe(true)
    expect(mocks.linkProgram).toHaveBeenCalledWith(program)
    // La liaison vient après les deux attachements.
    const lastAttach = Math.max(...mocks.attachShader.mock.invocationCallOrder)
    expect(mocks.linkProgram.mock.invocationCallOrder[0]).toBeGreaterThan(lastAttach)
    // Reste vivant : le programme seul.
    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })

  it('échec de compilation du fragment shader : le shader de sommets déjà créé est libéré', () => {
    const { gl, liveCounts } = createFakeGl({ failCompile: 'fragment' })

    expect(() => createProgram(gl, VERT, FRAG)).toThrow(SHADER_LOG)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('échec de compilation du vertex shader : rien n\'est créé en plus', () => {
    const { gl, mocks, liveCounts } = createFakeGl({ failCompile: 'vertex' })

    expect(() => createProgram(gl, VERT, FRAG)).toThrow(/sommets/)

    expect(mocks.createShader).toHaveBeenCalledOnce() // on s'arrête au premier échec
    expect(mocks.createProgram).not.toHaveBeenCalled()
    expect(liveCounts().shader).toBe(0)
  })

  it('échec de liaison : erreur avec le journal du programme, programme et shaders libérés', () => {
    const { gl, liveCounts } = createFakeGl({ failLink: true })

    let error: Error | undefined
    try {
      createProgram(gl, VERT, FRAG)
    } catch (e) {
      error = e as Error
    }

    expect(error?.message).toContain('liaison')
    expect(error?.message).toContain(PROGRAM_LOG)
    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('programme impossible à créer (null) : les deux shaders sont libérés', () => {
    const { gl, liveCounts } = createFakeGl({ failCreate: 'program' })

    expect(() => createProgram(gl, VERT, FRAG)).toThrow(/Impossible de créer le programme/)

    expect(liveCounts().shader).toBe(0)
  })
})
