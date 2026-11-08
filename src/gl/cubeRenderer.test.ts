import { length } from '../core/vec3'
import { createFakeGl } from '../test/fakeGl'
import { createCubeRenderer } from './cubeRenderer'

describe('createCubeRenderer : création', () => {
  it('crée un programme, trois buffers et un VAO (les shaders sont déjà libérés)', () => {
    const { gl, liveCounts } = createFakeGl()

    createCubeRenderer(gl)

    expect(liveCounts()).toEqual({ shader: 0, program: 1, buffer: 3, vertexArray: 1 })
  })

  it('active le test de profondeur et le face culling, avec le fond #F7F4EE', () => {
    const { gl, mocks } = createFakeGl()

    createCubeRenderer(gl)

    expect(mocks.enable).toHaveBeenCalledWith(gl.DEPTH_TEST)
    expect(mocks.enable).toHaveBeenCalledWith(gl.CULL_FACE)
    expect(mocks.cullFace).toHaveBeenCalledWith(gl.BACK)
    expect(mocks.frontFace).toHaveBeenCalledWith(gl.CCW)
    const [r, g, b, a] = mocks.clearColor.mock.calls[0]!
    expect(r).toBeCloseTo(0xf7 / 255)
    expect(g).toBeCloseTo(0xf4 / 255)
    expect(b).toBeCloseTo(0xee / 255)
    expect(a).toBe(1)
  })

  it('envoie la couleur du cube (#2E5D7C) et une direction de lumière de longueur 1', () => {
    const { gl, lastUniform } = createFakeGl()

    createCubeRenderer(gl)

    const color = lastUniform('uColor')!
    expect(color[0]).toBeCloseTo(0x2e / 255)
    expect(color[1]).toBeCloseTo(0x5d / 255)
    expect(color[2]).toBeCloseTo(0x7c / 255)
    const light = lastUniform('uLightDirection') as [number, number, number]
    expect(length(light)).toBeCloseTo(1, 5)
    // La lumière vient d'en haut, de la droite et de face (3, 4, 5) : toutes composantes positives.
    expect(light.every((c) => c > 0)).toBe(true)
  })

  it('envoie la matrice de vue de la caméra placée en (0, 0, 5) : translation de -5 en Z', () => {
    const { gl, lastUniform } = createFakeGl()

    createCubeRenderer(gl)

    const view = lastUniform('uView')!
    expect(view[14]).toBeCloseTo(-5)
    expect(view[0]).toBeCloseTo(1)
  })

  it('ne transpose jamais les matrices (elles sont déjà en colonnes-majeures)', () => {
    const { gl, uniformHistory } = createFakeGl()
    const renderer = createCubeRenderer(gl)
    renderer.setViewport(100, 100)
    renderer.draw(0.3)

    for (const name of ['uView', 'uProjection', 'uModel', 'uNormalMatrix']) {
      const history = uniformHistory(name)
      expect(history.length).toBeGreaterThan(0)
      expect(history.every((call) => call.transpose === false)).toBe(true)
    }
  })

  it('libère tout et lève l\'erreur du compilateur quand les shaders sont refusés', () => {
    const { gl, liveCounts } = createFakeGl({ failCompile: 'fragment' })

    expect(() => createCubeRenderer(gl)).toThrow(/compilation/)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('libère le programme si un uniform est introuvable', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    mocks.getUniformLocation.mockReturnValue(null as never)

    expect(() => createCubeRenderer(gl)).toThrow(/introuvable/)

    expect(liveCounts().program).toBe(0)
  })

  it('libère le programme et le VAO si un buffer ne peut pas être créé', () => {
    const { gl, liveCounts } = createFakeGl({ failCreate: 'buffer' })

    expect(() => createCubeRenderer(gl)).toThrow(/buffer/)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})

describe('createCubeRenderer : viewport et projection', () => {
  it('aligne le viewport sur la taille donnée', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createCubeRenderer(gl)

    renderer.setViewport(800, 400)

    expect(mocks.viewport).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 400)
  })

  it("règle l'aspect de la projection sur largeur / hauteur", () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createCubeRenderer(gl)

    renderer.setViewport(800, 400)
    const wide = lastUniform('uProjection')!
    renderer.setViewport(400, 800)
    const tall = lastUniform('uProjection')!

    // p[5] = f (échelle verticale), p[0] = f / aspect : leur rapport redonne l'aspect.
    expect(wide[5]! / wide[0]!).toBeCloseTo(2)
    expect(tall[5]! / tall[0]!).toBeCloseTo(0.5)
  })

  it('refuse une taille nulle plutôt que d\'envoyer une projection pleine de NaN', () => {
    const { gl, mocks, lastUniform } = createFakeGl()
    const renderer = createCubeRenderer(gl)
    const before = lastUniform('uProjection')

    expect(() => renderer.setViewport(0, 100)).toThrow(RangeError)
    expect(lastUniform('uProjection')).toEqual(before)
    expect(mocks.viewport).not.toHaveBeenCalled()
  })
})

describe('createCubeRenderer : dessin', () => {
  it('efface couleur et profondeur, puis dessine les 36 indices du cube', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createCubeRenderer(gl)

    renderer.draw(0)

    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    expect(mocks.drawElements).toHaveBeenCalledExactlyOnceWith(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
    expect(mocks.clear.mock.invocationCallOrder[0]).toBeLessThan(mocks.drawElements.mock.invocationCallOrder[0]!)
  })

  it("envoie les uniforms du modèle AVANT de dessiner", () => {
    const { gl, mocks, uniformHistory } = createFakeGl()
    const renderer = createCubeRenderer(gl)
    mocks.uniformMatrix4fv.mockClear()
    mocks.uniformMatrix3fv.mockClear()

    renderer.draw(0.5)

    expect(uniformHistory('uModel')).toHaveLength(1)
    expect(uniformHistory('uNormalMatrix')).toHaveLength(1)
    const drawOrder = mocks.drawElements.mock.invocationCallOrder[0]!
    expect(mocks.uniformMatrix4fv.mock.invocationCallOrder[0]).toBeLessThan(drawOrder)
    expect(mocks.uniformMatrix3fv.mock.invocationCallOrder[0]).toBeLessThan(drawOrder)
  })

  it("fait tourner le modèle autour de Y avec l'angle donné, et garde l'inclinaison en X", () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createCubeRenderer(gl)

    renderer.draw(0)
    const atZero = lastUniform('uModel')!
    renderer.draw(Math.PI / 2)
    const atQuarter = lastUniform('uModel')!

    // À l'angle 0 il ne reste que l'inclinaison de 0,4 rad autour de X : l'axe X est inchangé.
    expect(atZero[0]).toBeCloseTo(1)
    expect(atZero[5]).toBeCloseTo(Math.cos(0.4))
    // Après un quart de tour, l'axe X du cube pointe vers -Z (puis est incliné par la rotation en X).
    expect(atQuarter[0]).toBeCloseTo(0)
    expect(atQuarter).not.toEqual(atZero)
  })

  it('envoie une matrice normale qui est la rotation elle-même (rotation pure, pas d\'étirement)', () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createCubeRenderer(gl)

    renderer.draw(1.1)

    const model = lastUniform('uModel')!
    const normal = lastUniform('uNormalMatrix')!
    const rotationPart = [model[0], model[1], model[2], model[4], model[5], model[6], model[8], model[9], model[10]]
    expect(normal).toHaveLength(9)
    rotationPart.forEach((value, i) => expect(normal[i]).toBeCloseTo(value!, 5))
  })
})

describe('createCubeRenderer : libération', () => {
  it('dispose supprime le programme, les buffers et le VAO', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createCubeRenderer(gl)

    renderer.dispose()

    expect(mocks.deleteProgram).toHaveBeenCalledOnce()
    expect(mocks.deleteBuffer).toHaveBeenCalledTimes(3)
    expect(mocks.deleteVertexArray).toHaveBeenCalledOnce()
    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})
