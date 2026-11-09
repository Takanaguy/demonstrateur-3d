import { identity, rotationY } from '../core/mat4'
import { createFakeGl } from '../test/fakeGl'
import { createLineRenderer } from './lineRenderer'

/** Deux segments : quatre sommets. */
const TWO_SEGMENTS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0])
const RED = [1, 0, 0] as const

describe('createLineRenderer : le programme', () => {
  it('crée un seul programme (les shaders sont déjà libérés) et rien d\'autre', () => {
    const { gl, liveCounts } = createFakeGl()

    createLineRenderer(gl)

    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })

  it("demande les quatre uniforms du vertex et du fragment shader", () => {
    const { gl, mocks } = createFakeGl()

    createLineRenderer(gl)

    expect(mocks.getUniformLocation.mock.calls.map(([, name]) => name)).toEqual(['uModel', 'uView', 'uProjection', 'uColor'])
  })

  it('libère tout et lève l\'erreur du compilateur quand les shaders sont refusés', () => {
    const { gl, liveCounts } = createFakeGl({ failCompile: 'vertex' })

    expect(() => createLineRenderer(gl)).toThrow(/compilation/)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('libère le programme si un uniform est introuvable', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    mocks.getUniformLocation.mockReturnValue(null as never)

    expect(() => createLineRenderer(gl)).toThrow(/introuvable/)

    expect(liveCounts().program).toBe(0)
  })

  it('dispose supprime le programme', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const lines = createLineRenderer(gl)

    lines.dispose()

    expect(mocks.deleteProgram).toHaveBeenCalledOnce()
    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})

describe('createLineRenderer : vue et projection', () => {
  it('active le programme des lignes AVANT d\'envoyer la matrice, sans la transposer', () => {
    const { gl, mocks, uniformHistory } = createFakeGl()
    const lines = createLineRenderer(gl)
    const program = mocks.createProgram.mock.results[0]!.value
    mocks.useProgram.mockClear()
    const view = rotationY(0.5)
    const projection = rotationY(1.5) // n'importe quelle matrice reconnaissable

    lines.setView(view)
    lines.setProjection(projection)

    expect(mocks.useProgram.mock.calls).toEqual([[program], [program]])
    expect(mocks.useProgram.mock.invocationCallOrder[0]).toBeLessThan(mocks.uniformMatrix4fv.mock.invocationCallOrder[0]!)
    expect(mocks.useProgram.mock.invocationCallOrder[1]).toBeLessThan(mocks.uniformMatrix4fv.mock.invocationCallOrder[1]!)
    const [viewCall] = uniformHistory('uView')
    const [projectionCall] = uniformHistory('uProjection')
    expect(viewCall).toMatchObject({ transpose: false, values: Array.from(view), program, owner: program })
    expect(projectionCall).toMatchObject({ transpose: false, values: Array.from(projection), program, owner: program })
  })
})

describe('createLineRenderer : une série de segments', () => {
  it('crée un VAO et UN buffer, et y copie les positions', () => {
    const { gl, liveCounts, mocks } = createFakeGl()
    const lines = createLineRenderer(gl)

    lines.createSeries(TWO_SEGMENTS)

    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 1, vertexArray: 1 })
    expect(mocks.bufferData).toHaveBeenCalledExactlyOnceWith(gl.ARRAY_BUFFER, TWO_SEGMENTS, gl.STATIC_DRAW)
  })

  it('branche le buffer sur l\'entrée 0 (aPosition, comme line.vert) par paquets de 3 flottants', () => {
    const { gl, mocks, attributeBindings } = createFakeGl()
    const lines = createLineRenderer(gl)

    lines.createSeries(TWO_SEGMENTS)

    expect(mocks.enableVertexAttribArray.mock.calls).toEqual([[0]])
    expect(mocks.vertexAttribPointer.mock.calls).toEqual([[0, 3, gl.FLOAT, false, 0, 0]])
    expect(attributeBindings()).toEqual([{ location: 0, size: 3, data: Array.from(TWO_SEGMENTS) }])
  })

  it('le buffer est créé pendant que le VAO est actif (c\'est lui qui retient le câblage), puis le VAO est débranché', () => {
    const { gl, mocks } = createFakeGl()
    const lines = createLineRenderer(gl)

    lines.createSeries(TWO_SEGMENTS)

    const [bind, unbind] = mocks.bindVertexArray.mock.invocationCallOrder
    expect(mocks.bindVertexArray.mock.calls[1]).toEqual([null])
    expect(mocks.bufferData.mock.invocationCallOrder[0]).toBeGreaterThan(bind!)
    expect(mocks.vertexAttribPointer.mock.invocationCallOrder[0]).toBeLessThan(unbind!)
  })

  it('le nombre de sommets est deux par segment', () => {
    const { gl } = createFakeGl()
    const lines = createLineRenderer(gl)

    expect(lines.createSeries(TWO_SEGMENTS).vertexCount).toBe(4)
    expect(lines.createSeries(new Float32Array(6)).vertexCount).toBe(2)
  })

  it.each([
    ['vide', new Float32Array(0)],
    ['coupée au milieu d\'un segment (7 valeurs)', new Float32Array(7)],
    ['un seul point (3 valeurs)', new Float32Array(3)],
  ])('refuse une série %s, sans rien créer', (_name, positions) => {
    const { gl, liveCounts, mocks } = createFakeGl()
    const lines = createLineRenderer(gl)

    expect(() => lines.createSeries(positions)).toThrow(RangeError)

    expect(mocks.createVertexArray).not.toHaveBeenCalled()
    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })
})

describe('createLineRenderer : dessin', () => {
  it('draw active le programme, envoie la matrice du modèle et la couleur, puis dessine en gl.LINES tous les sommets', () => {
    const { gl, mocks, uniformHistory, draws } = createFakeGl()
    const lines = createLineRenderer(gl)
    const program = mocks.createProgram.mock.results[0]!.value
    const series = lines.createSeries(TWO_SEGMENTS)
    const vao = mocks.createVertexArray.mock.results[0]!.value
    mocks.useProgram.mockClear()
    mocks.bindVertexArray.mockClear()
    const model = rotationY(0.7)

    series.draw(model, RED)

    expect(mocks.drawArrays).toHaveBeenCalledExactlyOnceWith(gl.LINES, 0, 4)
    expect(mocks.drawElements).not.toHaveBeenCalled()
    expect(mocks.useProgram).toHaveBeenCalledExactlyOnceWith(program)
    expect(mocks.bindVertexArray.mock.calls).toEqual([[vao], [null]])
    expect(uniformHistory('uModel')).toEqual([{ transpose: false, values: Array.from(model), program, owner: program }])
    expect(uniformHistory('uColor')).toEqual([{ transpose: undefined, values: [1, 0, 0], program, owner: program }])
    expect(draws()).toEqual([{ call: 'drawArrays', mode: gl.LINES, count: 4, program, polygonOffsetFill: false }])
  })

  it('l\'ordre : programme actif, uniforms envoyés, VAO branché, PUIS le dessin', () => {
    const { gl, mocks } = createFakeGl()
    const lines = createLineRenderer(gl)
    const series = lines.createSeries(TWO_SEGMENTS)
    mocks.useProgram.mockClear()
    mocks.bindVertexArray.mockClear()
    mocks.uniformMatrix4fv.mockClear()

    series.draw(identity(), RED)

    const draw = mocks.drawArrays.mock.invocationCallOrder[0]!
    expect(mocks.useProgram.mock.invocationCallOrder[0]).toBeLessThan(mocks.uniformMatrix4fv.mock.invocationCallOrder[0]!)
    expect(mocks.uniformMatrix4fv.mock.invocationCallOrder[0]).toBeLessThan(draw)
    expect(mocks.uniform3fv.mock.invocationCallOrder[0]).toBeLessThan(draw)
    expect(mocks.bindVertexArray.mock.invocationCallOrder[0]).toBeLessThan(draw)
    expect(mocks.bindVertexArray.mock.invocationCallOrder[1]).toBeGreaterThan(draw)
  })

  it('deux séries se dessinent chacune avec leur propre VAO et leur propre nombre de sommets', () => {
    const { gl, mocks, draws } = createFakeGl()
    const lines = createLineRenderer(gl)
    const small = lines.createSeries(new Float32Array(6))
    const big = lines.createSeries(TWO_SEGMENTS)
    const [smallVao, bigVao] = mocks.createVertexArray.mock.results.map((result) => result.value)
    mocks.bindVertexArray.mockClear()

    small.draw(identity(), RED)
    big.draw(identity(), RED)

    expect(mocks.bindVertexArray.mock.calls.filter(([vao]) => vao !== null)).toEqual([[smallVao], [bigVao]])
    expect(draws().map((call) => call.count)).toEqual([2, 4])
  })
})

describe('createLineRenderer : libération', () => {
  it('series.dispose supprime son buffer et son VAO, une seule fois même si on l\'appelle deux fois', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const lines = createLineRenderer(gl)
    const series = lines.createSeries(TWO_SEGMENTS)

    series.dispose()
    series.dispose()

    expect(mocks.deleteBuffer).toHaveBeenCalledOnce()
    expect(mocks.deleteVertexArray).toHaveBeenCalledOnce()
    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })

  it('lines.dispose supprime aussi les séries oubliées, puis le programme : plus rien de vivant', () => {
    const { gl, liveCounts } = createFakeGl()
    const lines = createLineRenderer(gl)
    lines.createSeries(TWO_SEGMENTS)
    lines.createSeries(TWO_SEGMENTS)
    const freed = lines.createSeries(TWO_SEGMENTS)
    freed.dispose()

    lines.dispose()

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})

describe('createLineRenderer : échecs GPU', () => {
  it('un buffer qui ne peut pas être créé lève une erreur claire et libère le VAO', () => {
    const { gl, liveCounts } = createFakeGl({ failCreate: 'buffer' })
    const lines = createLineRenderer(gl)

    expect(() => lines.createSeries(TWO_SEGMENTS)).toThrow(/buffer/)

    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })

  it('un VAO qui ne peut pas être créé lève une erreur claire', () => {
    const { gl, liveCounts } = createFakeGl({ failCreate: 'vertexArray' })
    const lines = createLineRenderer(gl)

    expect(() => lines.createSeries(TWO_SEGMENTS)).toThrow(/VAO/)

    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })

  it('un bufferData sans mémoire GPU (OUT_OF_MEMORY lu par getError) lève l\'erreur et libère tout ce qui était créé', () => {
    // Sur un vrai GPU, bufferData ne lève rien : seul getError révèle l'échec.
    const { gl, liveCounts } = createFakeGl({ bufferDataError: { call: 1, code: 1285 } })
    const lines = createLineRenderer(gl)

    expect(() => lines.createSeries(TWO_SEGMENTS)).toThrow(/Mémoire graphique insuffisante/)

    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 0, vertexArray: 0 })
  })

  it('l\'erreur est lue APRÈS la copie et AVANT de débrancher le VAO', () => {
    const { gl, mocks } = createFakeGl()
    const lines = createLineRenderer(gl)

    lines.createSeries(TWO_SEGMENTS)

    const lastRead = mocks.getError.mock.invocationCallOrder.at(-1)!
    expect(lastRead).toBeGreaterThan(mocks.bufferData.mock.invocationCallOrder[0]!)
    expect(lastRead).toBeLessThan(mocks.bindVertexArray.mock.invocationCallOrder[1]!)
  })

  it('une erreur plus ancienne n\'est pas attribuée à cette série (file vidée avant la création)', () => {
    const { gl, queueError, liveCounts } = createFakeGl()
    const lines = createLineRenderer(gl)
    queueError(1285) // une vieille erreur, sans rapport

    expect(() => lines.createSeries(TWO_SEGMENTS)).not.toThrow()

    expect(liveCounts().buffer).toBe(1)
  })
})
