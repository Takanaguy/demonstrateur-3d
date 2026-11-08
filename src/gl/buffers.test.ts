import { createFakeGl } from '../test/fakeGl'
import { createBuffer, createIndexedMesh, createVertexArray, type IndexedMeshData } from './buffers'

/** Un triangle : 3 sommets, positions et normales, 3 indices. */
const triangle: IndexedMeshData = {
  attributes: [
    { location: 0, size: 3, data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
    { location: 1, size: 3, data: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) },
  ],
  indices: new Uint16Array([0, 1, 2]),
}

describe('createBuffer', () => {
  it('crée un buffer, le branche sur la cible et y copie les données', () => {
    const { gl, mocks } = createFakeGl()
    const data = new Float32Array([1, 2, 3])

    const buffer = createBuffer(gl, gl.ARRAY_BUFFER, data)

    expect(mocks.bindBuffer).toHaveBeenCalledWith(gl.ARRAY_BUFFER, buffer)
    expect(mocks.bufferData).toHaveBeenCalledWith(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    expect(mocks.bindBuffer.mock.invocationCallOrder[0]).toBeLessThan(mocks.bufferData.mock.invocationCallOrder[0]!)
  })

  it('lève une erreur claire quand le contexte ne fournit pas de buffer', () => {
    const { gl } = createFakeGl({ failCreate: 'buffer' })
    expect(() => createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(3))).toThrow(/buffer/)
  })
})

describe('createVertexArray', () => {
  it('lève une erreur claire quand le contexte ne fournit pas de VAO', () => {
    const { gl } = createFakeGl({ failCreate: 'vertexArray' })
    expect(() => createVertexArray(gl)).toThrow(/VAO/)
  })
})

describe('createIndexedMesh', () => {
  it('crée un VAO et un buffer par attribut plus un buffer d\'indices', () => {
    const { gl, liveCounts } = createFakeGl()

    createIndexedMesh(gl, triangle)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 3, vertexArray: 1 })
  })

  it('branche chaque attribut avec le bon format (3 flottants, non normalisés)', () => {
    const { gl, mocks } = createFakeGl()

    createIndexedMesh(gl, triangle)

    expect(mocks.enableVertexAttribArray.mock.calls).toEqual([[0], [1]])
    expect(mocks.vertexAttribPointer.mock.calls).toEqual([
      [0, 3, gl.FLOAT, false, 0, 0],
      [1, 3, gl.FLOAT, false, 0, 0],
    ])
  })

  it('crée le buffer d\'indices pendant que le VAO est actif (sinon le VAO ne le retiendrait pas)', () => {
    const { gl, mocks } = createFakeGl()

    createIndexedMesh(gl, triangle)

    const vaoBind = mocks.bindVertexArray.mock.invocationCallOrder[0]!
    const vaoUnbind = mocks.bindVertexArray.mock.invocationCallOrder[1]!
    const indexBufferCall = mocks.bindBuffer.mock.calls.findIndex(([target]) => target === gl.ELEMENT_ARRAY_BUFFER)
    const indexBind = mocks.bindBuffer.mock.invocationCallOrder[indexBufferCall]!
    expect(mocks.bindVertexArray.mock.calls[0]?.[0]).not.toBeNull()
    expect(mocks.bindVertexArray.mock.calls[1]).toEqual([null])
    expect(indexBind).toBeGreaterThan(vaoBind)
    expect(indexBind).toBeLessThan(vaoUnbind)
  })

  it('draw branche le VAO et dessine tous les triangles avec des indices 16 bits', () => {
    const { gl, mocks } = createFakeGl()
    const mesh = createIndexedMesh(gl, triangle)
    mocks.bindVertexArray.mockClear()

    mesh.draw()

    expect(mocks.bindVertexArray).toHaveBeenNthCalledWith(1, mesh.vao)
    expect(mocks.drawElements).toHaveBeenCalledExactlyOnceWith(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0)
  })

  it('dispose supprime tous les buffers et le VAO', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const mesh = createIndexedMesh(gl, triangle)

    mesh.dispose()

    expect(mocks.deleteBuffer).toHaveBeenCalledTimes(3)
    expect(mocks.deleteVertexArray).toHaveBeenCalledOnce()
    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('si un buffer ne peut pas être créé, ce qui existait déjà est supprimé avant de relancer l\'erreur', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    // Le troisième buffer (indices) échoue : les deux premiers et le VAO doivent partir.
    let calls = 0
    const original = mocks.createBuffer.getMockImplementation()!
    mocks.createBuffer.mockImplementation(() => (++calls === 3 ? null : original()))

    expect(() => createIndexedMesh(gl, triangle)).toThrow(/buffer/)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('refuse des données incohérentes avant de toucher au GPU', () => {
    const { gl, mocks } = createFakeGl()
    const bad = (data: IndexedMeshData) => () => createIndexedMesh(gl, data)

    expect(bad({ attributes: [], indices: new Uint16Array([0, 1, 2]) })).toThrow(RangeError)
    expect(bad({ ...triangle, attributes: [{ location: 0, size: 3, data: new Float32Array(4) }] })).toThrow(/divisent/)
    expect(bad({ ...triangle, attributes: [{ location: 0, size: 5, data: new Float32Array(5) }] })).toThrow(/taille/)
    expect(
      bad({
        ...triangle,
        attributes: [
          { location: 0, size: 3, data: new Float32Array(9) },
          { location: 1, size: 3, data: new Float32Array(12) },
        ],
      }),
    ).toThrow(/même nombre de sommets/)
    expect(bad({ ...triangle, indices: new Uint16Array([0, 1, 3]) })).toThrow(/hors limites/)
    expect(bad({ ...triangle, indices: new Uint16Array([0, 1]) })).toThrow(/triangles/)
    expect(mocks.createVertexArray).not.toHaveBeenCalled()
  })
})
