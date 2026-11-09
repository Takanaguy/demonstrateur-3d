import { DEFAULT_CAMERA, DISTANCE_RANGE, ELEVATION_RANGE, cameraPosition, type OrbitCamera } from '../core/camera'
import { createCubeGeometry } from '../core/cube'
import { lookAt } from '../core/mat4'
import { boundingBox, normalizeToUnitBox, type Mesh } from '../core/mesh'
import { createPlane, createSphere } from '../core/shapes'
import { DEFAULT_LIGHTING, type LightingSettings } from '../core/lighting'
import { DEFAULT_VIEW_OPTIONS } from '../core/viewOptions'
import { createFakeGl } from '../test/fakeGl'
import { createMeshRenderer } from './meshRenderer'

const cube = createCubeGeometry(2)

describe('createMeshRenderer : création', () => {
  it('crée un programme, trois buffers et un VAO (les shaders sont déjà libérés)', () => {
    const { gl, liveCounts } = createFakeGl()

    createMeshRenderer(gl, cube)

    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('active le test de profondeur, désactive le face culling, avec le fond #F7F4EE', () => {
    const { gl, mocks } = createFakeGl()

    createMeshRenderer(gl, cube)

    expect(mocks.enable).toHaveBeenCalledWith(gl.DEPTH_TEST)
    // Les plans et les OBJ ouverts doivent être visibles des deux côtés : jamais de culling.
    expect(mocks.enable).not.toHaveBeenCalledWith(gl.CULL_FACE)
    expect(mocks.disable).toHaveBeenCalledWith(gl.CULL_FACE)
    const [r, g, b, a] = mocks.clearColor.mock.calls[0]!
    expect(r).toBeCloseTo(0xf7 / 255)
    expect(g).toBeCloseTo(0xf4 / 255)
    expect(b).toBeCloseTo(0xee / 255)
    expect(a).toBe(1)
  })

  it('envoie la couleur du cube (#2E5D7C)', () => {
    const { gl, lastUniform } = createFakeGl()

    createMeshRenderer(gl, cube)

    const color = lastUniform('uColor')!
    expect(color[0]).toBeCloseTo(0x2e / 255)
    expect(color[1]).toBeCloseTo(0x5d / 255)
    expect(color[2]).toBeCloseTo(0x7c / 255)
  })

  it("envoie la position de la caméra de départ, la même que celle de la matrice de vue, pour calculer la direction vers l'oeil", () => {
    const { gl, lastUniform } = createFakeGl()

    createMeshRenderer(gl, cube)

    const position = lastUniform('uCameraPosition')!
    expect(position[0]).toBeCloseTo(0)
    expect(position[1]).toBeCloseTo(5 * Math.sin(0.4))
    expect(position[2]).toBeCloseTo(5 * Math.cos(0.4))
  })

  it("envoie la matrice de vue de la caméra de départ : l'origine est à 5 unités devant la caméra", () => {
    const { gl, lastUniform } = createFakeGl()

    createMeshRenderer(gl, cube)

    const view = lastUniform('uView')!
    // Dernière colonne : l'origine dans le repère de la caméra. Elle est sur l'axe du regard (x = y = 0),
    // à 5 unités devant (le regard va vers -Z).
    expect(view[12]).toBeCloseTo(0)
    expect(view[13]).toBeCloseTo(0)
    expect(view[14]).toBeCloseTo(-5)
  })

  it("branche les positions sur l'entrée 0 et les normales sur l'entrée 1, comme le vertex shader les lit", () => {
    const { gl, mocks, attributeBindings } = createFakeGl()

    createMeshRenderer(gl, cube)

    // Les deux entrées sont activées dans l'ordre 0 puis 1, chacune lue par paquets de 3 flottants.
    expect(mocks.enableVertexAttribArray.mock.calls).toEqual([[0], [1]])
    expect(mocks.vertexAttribPointer.mock.calls).toEqual([
      [0, 3, gl.FLOAT, false, 0, 0],
      [1, 3, gl.FLOAT, false, 0, 0],
    ])
    // Et ce qui alimente chaque entrée est le bon buffer : positions sur 0, normales sur 1.
    const geometry = normalizeToUnitBox(cube)
    const [positions, normals] = attributeBindings()
    expect(positions).toEqual({ location: 0, size: 3, data: Array.from(geometry.positions) })
    expect(normals).toEqual({ location: 1, size: 3, data: Array.from(geometry.normals) })
    // Garde-fou : si positions et normales étaient identiques, l'échange passerait inaperçu.
    expect(positions!.data).not.toEqual(normals!.data)
  })

  it('ne transpose jamais les matrices (elles sont déjà en colonnes-majeures)', () => {
    const { gl, uniformHistory } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
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

    expect(() => createMeshRenderer(gl, cube)).toThrow(/compilation/)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('libère le programme si un uniform est introuvable', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    mocks.getUniformLocation.mockReturnValue(null as never)

    expect(() => createMeshRenderer(gl, cube)).toThrow(/introuvable/)

    expect(liveCounts().program).toBe(0)
  })

  it('libère le programme et le VAO si un buffer ne peut pas être créé', () => {
    const { gl, liveCounts } = createFakeGl({ failCreate: 'buffer' })

    expect(() => createMeshRenderer(gl, cube)).toThrow(/buffer/)

    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})

describe('createMeshRenderer : éclairage', () => {
  const BLINN_PHONG: LightingSettings = {
    model: 'blinn-phong',
    position: [-2, 6.5, 1],
    color: '#FF8000',
    ambient: 0.2,
    specular: 0.7,
    shininess: 90,
    gaussianMean: 0.25,
    gaussianStdDev: 0.3,
  }

  it('envoie les réglages par défaut dès la création (lumière ponctuelle en (3, 4, 5), blanche, Lambert)', () => {
    const { gl, lastUniform } = createFakeGl()

    createMeshRenderer(gl, cube)

    expect(lastUniform('uLightingModel')).toEqual([0])
    expect(lastUniform('uLightPosition')).toEqual([3, 4, 5])
    expect(lastUniform('uLightColor')).toEqual([1, 1, 1])
    expect(lastUniform('uAmbient')).toEqual([0.35])
    expect(lastUniform('uSpecularIntensity')).toEqual([0.6])
    expect(lastUniform('uShininess')).toEqual([32])
    expect(lastUniform('uGaussianMean')).toEqual([0])
    expect(lastUniform('uGaussianStdDev')).toEqual([0.15])
  })

  it("applique les réglages donnés à la création plutôt que ceux par défaut", () => {
    const { gl, lastUniform } = createFakeGl()

    createMeshRenderer(gl, cube, BLINN_PHONG)

    expect(lastUniform('uLightingModel')).toEqual([1])
    expect(lastUniform('uLightPosition')).toEqual([-2, 6.5, 1])
  })

  it('setLighting envoie chaque réglage au bon uniform, avec la bonne valeur', () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setLighting(BLINN_PHONG)

    expect(lastUniform('uLightingModel')).toEqual([1])
    expect(lastUniform('uLightPosition')).toEqual([-2, 6.5, 1])
    const color = lastUniform('uLightColor')!
    expect(color[0]).toBeCloseTo(1)
    expect(color[1]).toBeCloseTo(0x80 / 255)
    expect(color[2]).toBeCloseTo(0)
    expect(lastUniform('uAmbient')).toEqual([0.2])
    expect(lastUniform('uSpecularIntensity')).toEqual([0.7])
    expect(lastUniform('uShininess')).toEqual([90])
    expect(lastUniform('uGaussianMean')).toEqual([0.25])
    expect(lastUniform('uGaussianStdDev')).toEqual([0.3])
  })

  it('envoie un numéro différent par modèle : 0 Lambert, 1 Blinn-Phong, 2 Gaussien (comme les constantes de mesh.frag)', () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setLighting({ ...DEFAULT_LIGHTING, model: 'blinn-phong' })
    expect(lastUniform('uLightingModel')).toEqual([1])
    renderer.setLighting({ ...DEFAULT_LIGHTING, model: 'gaussian' })
    expect(lastUniform('uLightingModel')).toEqual([2])
    renderer.setLighting({ ...DEFAULT_LIGHTING, model: 'lambert' })
    expect(lastUniform('uLightingModel')).toEqual([0])
  })

  it('envoie le modèle avec uniform1i (un entier), pas avec uniform1f, et les réels avec uniform1f', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.uniform1i.mockClear()
    mocks.uniform1f.mockClear()

    renderer.setLighting(BLINN_PHONG)

    // `uniform1i` n'a reçu QUE le modèle ; `uniform1f` ne l'a pas reçu.
    expect(mocks.uniform1i.mock.calls.map(([location, value]) => [(location as { name: string }).name, value])).toEqual([
      ['uLightingModel', 1],
    ])
    const floatNames = mocks.uniform1f.mock.calls.map(([location]) => (location as { name: string }).name)
    expect(floatNames).toEqual(['uAmbient', 'uSpecularIntensity', 'uShininess', 'uGaussianMean', 'uGaussianStdDev'])
  })

  it('active le programme AVANT d\'envoyer les uniforms (sinon ils iraient au mauvais programme)', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.useProgram.mockClear()
    mocks.uniform1i.mockClear()

    renderer.setLighting(BLINN_PHONG)

    expect(mocks.useProgram).toHaveBeenCalledOnce()
    expect(mocks.useProgram.mock.invocationCallOrder[0]).toBeLessThan(mocks.uniform1i.mock.invocationCallOrder[0]!)
  })

  it('borne les réglages hors plage avant de les envoyer', () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setLighting({ ...DEFAULT_LIGHTING, position: [100, -100, 3], ambient: 4, shininess: 9999, gaussianStdDev: 0 })

    expect(lastUniform('uLightPosition')).toEqual([10, -10, 3])
    expect(lastUniform('uAmbient')).toEqual([1])
    expect(lastUniform('uShininess')).toEqual([256])
    // Un écart type de 0 ferait diviser par zéro dans le shader : il est remonté au minimum.
    expect(lastUniform('uGaussianStdDev')).toEqual([0.02])
  })

  it('n\'envoie JAMAIS de NaN ni d\'infini, même avec des réglages fous (au départ comme après)', () => {
    const crazy = {
      ...DEFAULT_LIGHTING,
      position: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      ambient: Number.NaN,
      specular: Number.POSITIVE_INFINITY,
      shininess: Number.NaN,
      gaussianMean: Number.NaN,
      gaussianStdDev: Number.NaN,
      color: 'pas une couleur',
      model: 'inconnu',
    } as unknown as LightingSettings
    const { gl, uniformHistory } = createFakeGl()

    const renderer = createMeshRenderer(gl, cube, crazy)
    renderer.setLighting(crazy)

    const names = ['uLightPosition', 'uLightColor', 'uAmbient', 'uSpecularIntensity', 'uShininess', 'uGaussianMean', 'uGaussianStdDev', 'uLightingModel']
    for (const name of names) {
      const sent = uniformHistory(name).flatMap((call) => call.values)
      expect(sent.length, name).toBeGreaterThan(0)
      expect(sent.every(Number.isFinite), name).toBe(true)
    }
    // Les valeurs par défaut sont revenues à la place.
    expect(uniformHistory('uLightPosition').at(-1)!.values).toEqual([3, 4, 5])
    expect(uniformHistory('uLightingModel').at(-1)!.values).toEqual([0])
  })

  it('setLighting ne touche ni au maillage ni aux matrices ni à la couleur de l\'objet', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.createVertexArray.mockClear()
    mocks.uniformMatrix4fv.mockClear()
    mocks.uniformMatrix3fv.mockClear()
    const colorCalls = mocks.uniform3fv.mock.calls.filter(([location]) => (location as { name: string }).name === 'uColor').length

    renderer.setLighting(BLINN_PHONG)

    expect(mocks.createVertexArray).not.toHaveBeenCalled()
    expect(mocks.uniformMatrix4fv).not.toHaveBeenCalled()
    expect(mocks.uniformMatrix3fv).not.toHaveBeenCalled()
    expect(mocks.uniform3fv.mock.calls.filter(([location]) => (location as { name: string }).name === 'uColor')).toHaveLength(colorCalls)
    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('ne dépend plus de la direction fixe d\'avant : il n\'y a plus d\'uniform uLightDirection', () => {
    const { gl, mocks } = createFakeGl()

    createMeshRenderer(gl, cube)

    const requested = mocks.getUniformLocation.mock.calls.map(([, name]) => name)
    expect(requested).not.toContain('uLightDirection')
    expect(requested).toEqual(expect.arrayContaining(['uLightPosition', 'uCameraPosition', 'uLightingModel']))
  })
})

describe('createMeshRenderer : caméra', () => {
  const FAR_CAMERA: OrbitCamera = { azimuth: Math.PI / 2, elevation: 0.5, distance: 8 }

  it("setCamera envoie la matrice de vue ET la position de l'oeil, calculées ensemble", () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setCamera(FAR_CAMERA)

    const position = lastUniform('uCameraPosition')!
    expect(position[0]).toBeCloseTo(8 * Math.cos(0.5)) // azimut PI/2 : la caméra est du côté +X
    expect(position[1]).toBeCloseTo(8 * Math.sin(0.5))
    expect(position[2]).toBeCloseTo(0)
    // La matrice envoyée est celle d'un lookAt depuis CETTE position : les deux uniforms ne peuvent
    // pas se contredire (le reflet serait faux).
    const expectedView = lookAt([position[0]!, position[1]!, position[2]!], [0, 0, 0], [0, 1, 0])
    const view = lastUniform('uView')!
    expectedView.forEach((value, i) => expect(view[i]).toBeCloseTo(value))
  })

  it('la position envoyée est celle de cameraPosition, pour la caméra donnée', () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setCamera(FAR_CAMERA)

    expect(lastUniform('uCameraPosition')).toEqual(Array.from(cameraPosition(FAR_CAMERA)))
  })

  it('applique la caméra donnée à la création plutôt que celle par défaut', () => {
    const { gl, lastUniform } = createFakeGl()

    createMeshRenderer(gl, cube, DEFAULT_LIGHTING, FAR_CAMERA)

    expect(lastUniform('uCameraPosition')).toEqual(Array.from(cameraPosition(FAR_CAMERA)))
  })

  it("active chaque programme AVANT d'envoyer la vue de la caméra (sinon elle irait au mauvais programme)", () => {
    const { gl, mocks, uniformHistory } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    const [meshProgram, lineProgram] = mocks.createProgram.mock.results.map((result) => result.value)
    mocks.useProgram.mockClear()
    mocks.uniformMatrix4fv.mockClear()
    mocks.uniform3fv.mockClear()
    const viewCalls = uniformHistory('uView').length

    renderer.setCamera(FAR_CAMERA)

    // Deux programmes, deux `useProgram` : celui de l'objet (vue + position de l'oeil), puis celui des lignes (vue).
    expect(mocks.useProgram.mock.calls).toEqual([[meshProgram], [lineProgram]])
    const [objectUse, lineUse] = mocks.useProgram.mock.invocationCallOrder
    expect(objectUse).toBeLessThan(mocks.uniformMatrix4fv.mock.invocationCallOrder[0]!)
    expect(objectUse).toBeLessThan(mocks.uniform3fv.mock.invocationCallOrder[0]!)
    expect(lineUse).toBeLessThan(mocks.uniformMatrix4fv.mock.invocationCallOrder[1]!)
    // Et chaque matrice est bien arrivée dans le programme à qui appartient l'uniform.
    const sent = uniformHistory('uView').slice(viewCalls)
    expect(sent.map((call) => call.program)).toEqual([meshProgram, lineProgram])
    expect(sent.every((call) => call.program === call.owner)).toBe(true)
  })

  it('ne transpose pas la matrice de vue', () => {
    const { gl, uniformHistory } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setCamera(FAR_CAMERA)

    expect(uniformHistory('uView').every((call) => call.transpose === false)).toBe(true)
  })

  it("borne la caméra avant de l'envoyer : trop loin, trop près, trop haut", () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setCamera({ azimuth: 0, elevation: 99, distance: 1000 })

    const far = lastUniform('uCameraPosition')!
    // Ramenée à la distance maximale ET à l'élévation maximale (pas plus haut que le pôle).
    expect(Math.hypot(far[0]!, far[1]!, far[2]!)).toBeCloseTo(DISTANCE_RANGE.max)
    expect(far[1]).toBeCloseTo(DISTANCE_RANGE.max * Math.sin(ELEVATION_RANGE.max))
    renderer.setCamera({ azimuth: 0, elevation: 0, distance: 0.01 })
    const near = lastUniform('uCameraPosition')!
    expect(Math.hypot(near[0]!, near[1]!, near[2]!)).toBeCloseTo(DISTANCE_RANGE.min)
  })

  it("n'envoie JAMAIS de NaN ni d'infini, et ne lève pas, même avec une caméra folle (au départ comme après)", () => {
    const crazy: OrbitCamera = { azimuth: Number.NaN, elevation: Number.POSITIVE_INFINITY, distance: Number.NEGATIVE_INFINITY }
    const { gl, uniformHistory, lastUniform } = createFakeGl()

    const renderer = createMeshRenderer(gl, cube, DEFAULT_LIGHTING, crazy)
    expect(() => renderer.setCamera(crazy)).not.toThrow()

    for (const name of ['uView', 'uCameraPosition']) {
      const sent = uniformHistory(name).flatMap((call) => call.values)
      expect(sent.length, name).toBeGreaterThan(0)
      expect(sent.every(Number.isFinite), name).toBe(true)
    }
    // Les valeurs par défaut sont revenues à la place.
    expect(lastUniform('uCameraPosition')).toEqual(Array.from(cameraPosition(DEFAULT_CAMERA)))
  })

  it('une élévation au pôle ne fait pas échouer lookAt (la borne est appliquée avant)', () => {
    const { gl } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    expect(() => renderer.setCamera({ azimuth: 1, elevation: Math.PI / 2, distance: 5 })).not.toThrow()
    expect(() => renderer.setCamera({ azimuth: 1, elevation: -Math.PI / 2, distance: 5 })).not.toThrow()
  })

  it("setCamera ne touche ni au maillage, ni à l'éclairage, ni aux autres matrices", () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.createVertexArray.mockClear()
    mocks.uniform1i.mockClear()
    mocks.uniform1f.mockClear()
    mocks.uniformMatrix3fv.mockClear()
    mocks.uniformMatrix4fv.mockClear()

    renderer.setCamera(FAR_CAMERA)

    expect(mocks.createVertexArray).not.toHaveBeenCalled()
    expect(mocks.uniform1i).not.toHaveBeenCalled()
    expect(mocks.uniform1f).not.toHaveBeenCalled()
    expect(mocks.uniformMatrix3fv).not.toHaveBeenCalled()
    // Deux matrices 4x4 envoyées, toutes deux la vue (une par programme : objet et lignes), ni modèle ni projection.
    expect(mocks.uniformMatrix4fv).toHaveBeenCalledTimes(2)
    for (const [location] of mocks.uniformMatrix4fv.mock.calls) {
      expect((location as unknown as { name: string }).name).toBe('uView')
    }
    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('dessiner ne renvoie pas la caméra : elle garde la dernière donnée par setCamera', () => {
    const { gl, uniformHistory } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    renderer.setCamera(FAR_CAMERA)
    const sent = uniformHistory('uView').length

    renderer.draw(0.2)
    renderer.draw(0.4)

    expect(uniformHistory('uView')).toHaveLength(sent)
  })
})

describe('createMeshRenderer : options de vue', () => {
  it('par défaut : face culling désactivé, test de profondeur actif', () => {
    const { gl, isEnabled } = createFakeGl()

    createMeshRenderer(gl, cube)

    expect(isEnabled(gl.CULL_FACE)).toBe(false)
    expect(isEnabled(gl.DEPTH_TEST)).toBe(true)
  })

  it('backfaceCulling à true : active CULL_FACE et élimine les faces BACK (vues de dos)', () => {
    const { gl, mocks, isEnabled, cullFaceMode } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, backfaceCulling: true })

    expect(isEnabled(gl.CULL_FACE)).toBe(true)
    expect(mocks.enable).toHaveBeenCalledWith(gl.CULL_FACE)
    expect(cullFaceMode()).toBe(gl.BACK)
    expect(mocks.cullFace).toHaveBeenCalledWith(gl.BACK)
  })

  it('backfaceCulling repassé à false : désactive de nouveau CULL_FACE', () => {
    const { gl, isEnabled } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, backfaceCulling: true })

    renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, backfaceCulling: false })

    expect(isEnabled(gl.CULL_FACE)).toBe(false)
  })

  it('applique les options données à la création (culling actif dès le départ)', () => {
    const { gl, isEnabled, cullFaceMode } = createFakeGl()

    createMeshRenderer(gl, cube, DEFAULT_LIGHTING, DEFAULT_CAMERA, { ...DEFAULT_VIEW_OPTIONS, backfaceCulling: true })

    expect(isEnabled(gl.CULL_FACE)).toBe(true)
    expect(cullFaceMode()).toBe(gl.BACK)
  })

  it('setViewOptions ne touche ni à la profondeur, ni aux uniforms, ni au maillage', () => {
    const { gl, mocks, isEnabled, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.createVertexArray.mockClear()
    mocks.uniformMatrix4fv.mockClear()
    mocks.uniform1i.mockClear()
    mocks.uniform3fv.mockClear()

    renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, backfaceCulling: true })

    expect(isEnabled(gl.DEPTH_TEST)).toBe(true)
    expect(mocks.createVertexArray).not.toHaveBeenCalled()
    expect(mocks.uniformMatrix4fv).not.toHaveBeenCalled()
    expect(mocks.uniform1i).not.toHaveBeenCalled()
    expect(mocks.uniform3fv).not.toHaveBeenCalled()
    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it("autoRotate n'est pas l'affaire du renderer : le changer ne touche pas au GPU", () => {
    const { gl, mocks, isEnabled } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.enable.mockClear()

    renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, autoRotate: false })

    // Seul backfaceCulling compte : le culling reste désactivé et rien n'est activé.
    expect(mocks.enable).not.toHaveBeenCalled()
    expect(isEnabled(gl.CULL_FACE)).toBe(false)
  })
})

describe('createMeshRenderer : viewport et projection', () => {
  it('aligne le viewport sur la taille donnée', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setViewport(800, 400)

    expect(mocks.viewport).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 400)
  })

  it("règle l'aspect de la projection sur largeur / hauteur", () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

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
    const renderer = createMeshRenderer(gl, cube)
    const before = lastUniform('uProjection')

    expect(() => renderer.setViewport(0, 100)).toThrow(RangeError)
    expect(lastUniform('uProjection')).toEqual(before)
    expect(mocks.viewport).not.toHaveBeenCalled()
  })
})

describe('createMeshRenderer : dessin', () => {
  it('efface couleur et profondeur, puis dessine les 36 indices du cube (indices 16 bits)', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.draw(0)

    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    expect(mocks.drawElements).toHaveBeenCalledExactlyOnceWith(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
    expect(mocks.clear.mock.invocationCallOrder[0]).toBeLessThan(mocks.drawElements.mock.invocationCallOrder[0]!)
  })

  it("envoie les uniforms du modèle AVANT de dessiner", () => {
    const { gl, mocks, uniformHistory } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    mocks.uniformMatrix4fv.mockClear()
    mocks.uniformMatrix3fv.mockClear()

    renderer.draw(0.5)

    expect(uniformHistory('uModel')).toHaveLength(1)
    expect(uniformHistory('uNormalMatrix')).toHaveLength(1)
    const drawOrder = mocks.drawElements.mock.invocationCallOrder[0]!
    expect(mocks.uniformMatrix4fv.mock.invocationCallOrder[0]).toBeLessThan(drawOrder)
    expect(mocks.uniformMatrix3fv.mock.invocationCallOrder[0]).toBeLessThan(drawOrder)
  })

  it("fait tourner le modèle UNIQUEMENT autour de Y (plus d'inclinaison : elle vient de la caméra)", () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.draw(0)
    const atZero = Array.from(lastUniform('uModel')!)
    renderer.draw(Math.PI / 2)
    const atQuarter = lastUniform('uModel')!

    // À l'angle 0 le modèle ne bouge rien : c'est l'identité (avant, il restait 0,4 rad autour de X).
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    identity.forEach((value, i) => expect(atZero[i]).toBeCloseTo(value)) // toBeCloseTo : -0 et 0 sont égaux
    // Après un quart de tour autour de Y, l'axe X du cube pointe vers -Z, et l'axe Y ne bouge pas.
    expect(atQuarter[0]).toBeCloseTo(0)
    expect(atQuarter[2]).toBeCloseTo(-1)
    expect(atQuarter[5]).toBeCloseTo(1)
    expect(atQuarter[6]).toBeCloseTo(0)
  })

  it('envoie une matrice normale qui est la rotation elle-même (rotation pure, pas d\'étirement)', () => {
    const { gl, lastUniform } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.draw(1.1)

    const model = lastUniform('uModel')!
    const normal = lastUniform('uNormalMatrix')!
    const rotationPart = [model[0], model[1], model[2], model[4], model[5], model[6], model[8], model[9], model[10]]
    expect(normal).toHaveLength(9)
    rotationPart.forEach((value, i) => expect(normal[i]).toBeCloseTo(value!, 5))
  })
})

describe('createMeshRenderer : libération', () => {
  it('dispose supprime le programme, les buffers et le VAO', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.dispose()

    expect(mocks.deleteProgram).toHaveBeenCalledTimes(2) // l'objet et les lignes
    expect(mocks.deleteBuffer).toHaveBeenCalledTimes(3)
    expect(mocks.deleteVertexArray).toHaveBeenCalledOnce()
    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})

describe('createMeshRenderer : maillage affiché', () => {
  it('normalise le maillage avant de l\'envoyer : un modèle immense et décalé tient dans la boîte unité', () => {
    const { gl, attributeBindings } = createFakeGl()
    const huge: Mesh = {
      positions: new Float32Array([1000, 1000, 1000, 3000, 1000, 1000, 1000, 2000, 1000]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    }

    createMeshRenderer(gl, huge)

    const sent = new Float32Array(attributeBindings()[0]!.data)
    expect(boundingBox({ ...huge, positions: sent })).toEqual({ min: [-1, -0.5, 0], max: [1, 0.5, 0] })
  })

  it('dessine autant d\'indices que le maillage en a', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, createPlane())

    renderer.draw(0)

    expect(mocks.drawElements).toHaveBeenCalledExactlyOnceWith(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  })

  it('dessine avec des indices 32 bits quand le maillage en a (UNSIGNED_INT)', () => {
    const { gl, mocks } = createFakeGl()
    const big: Mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    }
    const renderer = createMeshRenderer(gl, big)

    renderer.draw(0)

    expect(mocks.drawElements).toHaveBeenCalledExactlyOnceWith(gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0)
  })
})

describe('createMeshRenderer : setMesh', () => {
  it('envoie le nouveau maillage normalisé sur les entrées 0 (positions) et 1 (normales)', () => {
    const { gl, attributeBindings } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    const sphere = createSphere(8, 4)

    renderer.setMesh(sphere)

    const [positions, normals] = attributeBindings().slice(-2)
    const expected = normalizeToUnitBox(sphere)
    expect(positions).toEqual({ location: 0, size: 3, data: Array.from(expected.positions) })
    expect(normals).toEqual({ location: 1, size: 3, data: Array.from(expected.normals) })
  })

  it('libère l\'ancien VAO et ses buffers, sans fuite : toujours un seul jeu de ressources vivant', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    const oldVao = mocks.createVertexArray.mock.results[0]!.value
    const oldBuffers = mocks.createBuffer.mock.results.map((result) => result.value)

    renderer.setMesh(createSphere(8, 4))

    expect(mocks.deleteVertexArray).toHaveBeenCalledExactlyOnceWith(oldVao)
    expect(mocks.deleteBuffer.mock.calls.map(([buffer]) => buffer)).toEqual(oldBuffers)
    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })

    renderer.setMesh(createPlane())
    renderer.setMesh(cube)
    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })

    renderer.dispose()
    expect(liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('le dessin suivant utilise le nouveau maillage (nombre d\'indices du plan : 6)', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)

    renderer.setMesh(createPlane())
    renderer.draw(0)

    expect(mocks.drawElements).toHaveBeenCalledExactlyOnceWith(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  })

  it('passe de 16 à 32 bits d\'un maillage à l\'autre', () => {
    const { gl, mocks } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    const big: Mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    }

    renderer.setMesh(big)
    renderer.draw(0)

    expect(mocks.drawElements).toHaveBeenLastCalledWith(gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0)
  })

  it('si la création du nouveau maillage échoue : l\'erreur remonte et l\'ancien reste affiché, rien ne fuit', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    const oldVao = mocks.createVertexArray.mock.results[0]!.value
    mocks.createBuffer.mockReturnValue(null) // plus de mémoire GPU

    expect(() => renderer.setMesh(createSphere(8, 4))).toThrow(/buffer/)

    // L'ancien jeu est intact (rien de supprimé) et le nouveau, à moitié créé, a été nettoyé.
    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
    expect(mocks.deleteVertexArray).toHaveBeenCalledTimes(1) // seulement le VAO du nouveau, pas l'ancien
    expect(mocks.deleteVertexArray).not.toHaveBeenCalledWith(oldVao)
    mocks.bindVertexArray.mockClear()
    renderer.draw(0)
    expect(mocks.bindVertexArray).toHaveBeenNthCalledWith(1, oldVao) // c'est bien l'ancien maillage qui est dessiné
    expect(mocks.drawElements).toHaveBeenLastCalledWith(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
  })

  it('si le GPU manque de mémoire (OUT_OF_MEMORY via getError) : l\'erreur remonte, l\'ancien est intact, rien ne fuit', () => {
    // Le cube initial fait les appels 1 à 3 à bufferData ; la sphère fait 4 (positions), 5 (normales), 6 (indices).
    const { gl, mocks, liveCounts } = createFakeGl({ bufferDataError: { call: 5, code: 1285 } })
    const renderer = createMeshRenderer(gl, cube)
    const oldVao = mocks.createVertexArray.mock.results[0]!.value

    expect(() => renderer.setMesh(createSphere(8, 4))).toThrow(/Mémoire graphique insuffisante/)

    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
    expect(mocks.deleteVertexArray).toHaveBeenCalledTimes(1)
    expect(mocks.deleteVertexArray).not.toHaveBeenCalledWith(oldVao)
    mocks.bindVertexArray.mockClear()
    renderer.draw(0)
    expect(mocks.bindVertexArray).toHaveBeenNthCalledWith(1, oldVao)
    expect(mocks.drawElements).toHaveBeenLastCalledWith(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
  })

  it('un maillage vide est refusé et l\'ancien reste affiché', () => {
    const { gl, mocks, liveCounts } = createFakeGl()
    const renderer = createMeshRenderer(gl, cube)
    const empty: Mesh = { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint16Array(0) }

    expect(() => renderer.setMesh(empty)).toThrow(RangeError)

    expect(liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
    renderer.draw(0)
    expect(mocks.drawElements).toHaveBeenLastCalledWith(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0)
  })
})
