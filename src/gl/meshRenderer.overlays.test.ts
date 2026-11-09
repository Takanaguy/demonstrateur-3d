import { DEFAULT_CAMERA } from '../core/camera'
import { createCubeGeometry } from '../core/cube'
import { DEFAULT_LIGHTING } from '../core/lighting'
import { identity, rotationY } from '../core/mat4'
import { normalizeToUnitBox, type Mesh } from '../core/mesh'
import { boundingBoxSegments, edgesOfMesh } from '../core/overlays'
import { createPlane, createSphere } from '../core/shapes'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
import { createFakeGl, type FakeGlOptions } from '../test/fakeGl'
import { createMeshRenderer } from './meshRenderer'

// Les aides en traits (fil de fer, normales, boîte, grille, axes) et les trois modes d'affichage, vus à
// travers ce que le faux contexte enregistre : quels dessins, dans quel ordre, avec quel programme, quelle
// matrice, quelle couleur, et quel état du polygon offset.

const cube = createCubeGeometry(2)
const OUT_OF_MEMORY = 1285

/** Crée un renderer du cube avec des options (par défaut + changements) et retrouve ses deux programmes. */
function setup(changes: Partial<ViewOptions> = {}, fakeOptions: FakeGlOptions = {}, mesh: Mesh = cube) {
  const fake = createFakeGl(fakeOptions)
  const onOverlayError = vi.fn()
  const options = { ...DEFAULT_VIEW_OPTIONS, ...changes }
  const renderer = createMeshRenderer(fake.gl, mesh, DEFAULT_LIGHTING, DEFAULT_CAMERA, options, onOverlayError)
  // Le programme de l'objet est créé avant celui des lignes.
  const [meshProgram, lineProgram] = fake.mocks.createProgram.mock.results.map((result) => result.value)
  return { ...fake, renderer, onOverlayError, meshProgram, lineProgram }
}

type Setup = ReturnType<typeof setup>

/** Les valeurs envoyées à un uniform du programme des LIGNES, dans l'ordre. */
function lineUniform({ uniformHistory, lineProgram }: Setup, name: string) {
  return uniformHistory(name)
    .filter((call) => call.program === lineProgram)
    .map((call) => call.values)
}

/** Les valeurs envoyées à un uniform du programme de l'OBJET, dans l'ordre. */
function meshUniform({ uniformHistory, meshProgram }: Setup, name: string) {
  return uniformHistory(name)
    .filter((call) => call.program === meshProgram)
    .map((call) => call.values)
}

/** Les dessins en traits (gl.LINES), dans l'ordre. */
function lineDraws(s: Setup) {
  return s.draws().filter((call) => call.mode === s.gl.LINES)
}

const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)

function expectColor(actual: number[] | undefined, expectedHex: string) {
  const expected = hex(expectedHex)
  expect(actual).toHaveLength(3)
  actual!.forEach((channel, i) => expect(channel).toBeCloseTo(expected[i]!, 5))
}

describe('modes d\'affichage : plein, fil de fer, les deux', () => {
  it('plein (le défaut) : un seul dessin, les triangles de l\'objet ; ni trait, ni polygon offset', () => {
    const s = setup()

    s.renderer.draw(0.3)

    expect(s.draws()).toEqual([
      { call: 'drawElements', mode: s.gl.TRIANGLES, count: 36, program: s.meshProgram, polygonOffsetFill: false },
    ])
    expect(s.mocks.drawArrays).not.toHaveBeenCalled()
    expect(s.mocks.polygonOffset).not.toHaveBeenCalled()
    expect(s.mocks.enable).not.toHaveBeenCalledWith(s.gl.POLYGON_OFFSET_FILL)
  })

  it('plein : aucune aide n\'est créée, il n\'y a toujours que les 3 buffers et le VAO du maillage', () => {
    const s = setup()

    s.renderer.draw(0)

    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('fil de fer seul : les arêtes (18 segments, donc 36 sommets) en gl.LINES, et AUCUN remplissage dessiné', () => {
    const s = setup({ displayMode: 'wireframe' })

    s.renderer.draw(0.3)

    expect(s.mocks.drawElements).not.toHaveBeenCalled()
    expect(s.draws()).toEqual([
      { call: 'drawArrays', mode: s.gl.LINES, count: 36, program: s.lineProgram, polygonOffsetFill: false },
    ])
    // Sans remplissage, le programme de l'objet ne reçoit ni modèle ni matrice normale.
    expect(meshUniform(s, 'uModel')).toHaveLength(0)
    expect(meshUniform(s, 'uNormalMatrix')).toHaveLength(0)
  })

  it('fil de fer seul : jamais de polygon offset (il n\'y a pas de surface à repousser)', () => {
    const s = setup({ displayMode: 'wireframe' })

    s.renderer.draw(0)

    expect(s.mocks.polygonOffset).not.toHaveBeenCalled()
    expect(s.mocks.enable).not.toHaveBeenCalledWith(s.gl.POLYGON_OFFSET_FILL)
  })

  it('plein ET fil de fer : d\'abord les triangles, puis les traits par-dessus', () => {
    const s = setup({ displayMode: 'solid-wireframe' })

    s.renderer.draw(0.3)

    expect(s.draws().map((call) => [call.call, call.mode, call.count, call.program])).toEqual([
      ['drawElements', s.gl.TRIANGLES, 36, s.meshProgram],
      ['drawArrays', s.gl.LINES, 36, s.lineProgram],
    ])
  })

  it('plein ET fil de fer : le polygon offset (1, 1) est actif PENDANT le remplissage seulement, et désactivé ensuite', () => {
    const s = setup({ displayMode: 'solid-wireframe' })

    s.renderer.draw(0.3)

    const [fill, lines] = s.draws()
    expect(fill!.polygonOffsetFill).toBe(true) // les surfaces sont repoussées en arrière...
    expect(lines!.polygonOffsetFill).toBe(false) // ...pas les traits (qui d'ailleurs ne sont pas des polygones)
    expect(s.mocks.polygonOffset).toHaveBeenCalledExactlyOnceWith(1, 1)
    expect(s.isEnabled(s.gl.POLYGON_OFFSET_FILL)).toBe(false) // et il n'est pas resté actif après l'image
    // L'ordre : activé, puis le dessin des triangles, puis désactivé.
    const enableOrder = s.mocks.enable.mock.calls.findIndex(([capability]) => capability === s.gl.POLYGON_OFFSET_FILL)
    expect(s.mocks.enable.mock.invocationCallOrder[enableOrder]).toBeLessThan(s.mocks.drawElements.mock.invocationCallOrder[0]!)
    expect(s.mocks.drawElements.mock.invocationCallOrder[0]).toBeLessThan(s.mocks.disable.mock.invocationCallOrder.at(-1)!)
  })

  it('le polygon offset est réglé à chaque image combinée et jamais laissé actif : plusieurs images de suite', () => {
    const s = setup({ displayMode: 'solid-wireframe' })

    s.renderer.draw(0.1)
    s.renderer.draw(0.2)
    s.renderer.draw(0.3)

    expect(s.draws().filter((call) => call.call === 'drawElements').map((call) => call.polygonOffsetFill)).toEqual([true, true, true])
    expect(s.isEnabled(s.gl.POLYGON_OFFSET_FILL)).toBe(false)
  })

  it('changer de mode avec setViewOptions change les dessins de l\'image suivante (sans recréer le maillage)', () => {
    const s = setup()
    s.renderer.draw(0)
    s.clearDraws()
    const vaoCreated = s.mocks.createVertexArray.mock.calls.length

    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'wireframe' })
    s.renderer.draw(0)
    expect(s.draws().map((call) => call.call)).toEqual(['drawArrays'])

    s.clearDraws()
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'solid-wireframe' })
    s.renderer.draw(0)
    expect(s.draws().map((call) => [call.call, call.polygonOffsetFill])).toEqual([
      ['drawElements', true],
      ['drawArrays', false],
    ])

    s.clearDraws()
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'solid' })
    s.renderer.draw(0)
    expect(s.draws().map((call) => [call.call, call.polygonOffsetFill])).toEqual([['drawElements', false]])
    // Un seul VAO de plus : celui des arêtes (créé une fois, gardé ensuite), le maillage n'a pas été recréé.
    expect(s.mocks.createVertexArray.mock.calls.length).toBe(vaoCreated + 1)
  })

  it('le mode d\'affichage donné à la création est appliqué dès la première image', () => {
    const s = setup({ displayMode: 'wireframe' })

    s.renderer.draw(0)

    expect(s.draws().map((call) => call.call)).toEqual(['drawArrays'])
  })
})

describe('arêtes : calcul paresseux, sur le maillage normalisé, mises en cache', () => {
  it('rien n\'est calculé ni envoyé au GPU tant qu\'on ne passe pas en fil de fer', () => {
    const s = setup()

    s.renderer.draw(0)
    s.renderer.draw(0)
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'wireframe' })

    // Le changement d'option seul ne crée rien non plus : c'est le premier dessin qui s'en charge.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('le premier dessin en fil de fer envoie les arêtes du maillage NORMALISÉ au GPU', () => {
    const huge: Mesh = {
      positions: new Float32Array([1000, 1000, 1000, 3000, 1000, 1000, 1000, 2000, 1000]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    }
    const s = setup({ displayMode: 'wireframe' }, {}, huge)

    s.renderer.draw(0)

    const sent = s.attributeBindings().at(-1)!
    expect(sent.location).toBe(0)
    expect(sent.data).toEqual(Array.from(edgesOfMesh(normalizeToUnitBox(huge))))
    // Normalisé : tient dans la boîte de -1 à +1, pas dans les coordonnées d'origine (1 000 à 3 000).
    expect(Math.max(...sent.data.map(Math.abs))).toBeLessThanOrEqual(1)
  })

  it('les arêtes sont envoyées UNE seule fois, puis réutilisées à chaque image', () => {
    const s = setup({ displayMode: 'wireframe' })

    s.renderer.draw(0.1)
    const buffers = s.mocks.createBuffer.mock.calls.length
    s.renderer.draw(0.2)
    s.renderer.draw(0.3)

    expect(s.mocks.createBuffer.mock.calls.length).toBe(buffers)
    expect(s.draws()).toHaveLength(3)
  })

  it('repasser en plein puis en fil de fer réutilise les arêtes déjà envoyées', () => {
    const s = setup({ displayMode: 'wireframe' })
    s.renderer.draw(0)
    const buffers = s.mocks.createBuffer.mock.calls.length

    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'solid' })
    s.renderer.draw(0)
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'wireframe' })
    s.renderer.draw(0)

    expect(s.mocks.createBuffer.mock.calls.length).toBe(buffers)
  })

  it('les traits du fil de fer utilisent la MÊME matrice de modèle que l\'objet (ils tournent avec lui)', () => {
    const s = setup({ displayMode: 'solid-wireframe' })

    s.renderer.draw(0.9)

    const expected = Array.from(rotationY(0.9))
    expect(meshUniform(s, 'uModel').at(-1)).toEqual(expected)
    expect(lineUniform(s, 'uModel')).toEqual([expected])
  })

  it('les arêtes sont dessinées en gris foncé (#1F2937)', () => {
    const s = setup({ displayMode: 'wireframe' })

    s.renderer.draw(0)

    expectColor(lineUniform(s, 'uColor').at(-1), '#1F2937')
  })

  it('setMesh JETTE les arêtes de l\'ancien maillage et les recalcule pour le nouveau, au dessin suivant', () => {
    const s = setup({ displayMode: 'wireframe' })
    s.renderer.draw(0)
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 4, vertexArray: 2 }) // maillage + arêtes
    const sphere = createSphere(8, 4)

    s.renderer.setMesh(sphere)

    // Les arêtes du cube sont supprimées tout de suite (rien d'autre qu'un maillage vivant), pas gardées par erreur.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
    s.clearDraws()
    s.renderer.draw(0)
    // Les arêtes de la sphère : 3 x 8 x 3 = 72 segments, donc 144 sommets, envoyées telles que calculées.
    expect(lineDraws(s)).toHaveLength(1)
    expect(lineDraws(s)[0]!.count).toBe(144)
    expect(s.attributeBindings().at(-1)!.data).toEqual(Array.from(edgesOfMesh(normalizeToUnitBox(sphere))))
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 4, vertexArray: 2 })
  })

  it('setMesh jette aussi les normales et la boîte (elles dépendent du maillage), mais garde la grille et les axes', () => {
    const s = setup({ showNormals: true, showBoundingBox: true, showGrid: true, showAxes: true })
    s.renderer.draw(0)
    // maillage (3) + normales (1) + boîte (1) + grille (1) + axes (3) : autant de VAO que de buffers sauf le maillage.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 9, vertexArray: 7 })

    s.renderer.setMesh(createPlane())

    // Il ne reste que le nouveau maillage, la grille et les trois axes.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 7, vertexArray: 5 })
    const buffersBefore = s.mocks.createBuffer.mock.calls.length
    s.renderer.draw(0)
    // Redessiner recrée les deux aides de l'objet (normales et boîte), pas la grille ni les axes.
    expect(s.mocks.createBuffer.mock.calls.length - buffersBefore).toBe(2)
  })

  it('si setMesh échoue, l\'ancien maillage reste affiché AVEC ses arêtes (rien n\'est jeté)', () => {
    const s = setup({ displayMode: 'solid-wireframe' })
    s.renderer.draw(0)
    const edges = s.attributeBindings().at(-1)!.data
    s.mocks.createBuffer.mockReturnValue(null) // plus de mémoire GPU pour le nouveau maillage

    expect(() => s.renderer.setMesh(createSphere(8, 4))).toThrow(/buffer/)

    s.clearDraws()
    s.renderer.draw(0)
    expect(s.draws().map((call) => [call.call, call.count])).toEqual([
      ['drawElements', 36],
      ['drawArrays', 36],
    ])
    expect(edges).toEqual(Array.from(edgesOfMesh(normalizeToUnitBox(cube))))
  })
})

describe('autres aides : normales, boîte, grille, axes', () => {
  it('chaque aide n\'est dessinée que si son option est active', () => {
    const s = setup()
    s.renderer.draw(0)
    expect(lineDraws(s)).toHaveLength(0)

    const cases: [Partial<ViewOptions>, number[]][] = [
      [{ showNormals: true }, [48]], // 24 sommets du cube, un segment chacun
      [{ showBoundingBox: true }, [24]], // 12 arêtes
      [{ showGrid: true }, [52]], // 13 lignes dans chaque sens
      [{ showAxes: true }, [2, 2, 2]], // trois axes, un segment chacun
    ]
    for (const [change, counts] of cases) {
      const only = setup(change)
      only.renderer.draw(0)
      expect(lineDraws(only).map((call) => call.count), JSON.stringify(change)).toEqual(counts)
      // Un fil de fer n'apparaît pas pour autant : le remplissage reste dessiné.
      expect(only.draws().filter((call) => call.call === 'drawElements')).toHaveLength(1)
    }
  })

  it('toutes ensemble : fil de fer, normales, boîte, grille puis axes, dans cet ordre, après le remplissage', () => {
    const s = setup({
      displayMode: 'solid-wireframe',
      showNormals: true,
      showBoundingBox: true,
      showGrid: true,
      showAxes: true,
    })

    s.renderer.draw(0)

    expect(s.draws().map((call) => [call.call, call.count])).toEqual([
      ['drawElements', 36],
      ['drawArrays', 36], // arêtes
      ['drawArrays', 48], // normales
      ['drawArrays', 24], // boîte
      ['drawArrays', 52], // grille
      ['drawArrays', 2], // axe X
      ['drawArrays', 2], // axe Y
      ['drawArrays', 2], // axe Z
    ])
  })

  it('les couleurs : normales ambre, boîte grise, grille gris clair, axes rouge, vert et bleu', () => {
    const s = setup({ showNormals: true, showBoundingBox: true, showGrid: true, showAxes: true })

    s.renderer.draw(0)

    const colors = lineUniform(s, 'uColor')
    expect(colors).toHaveLength(6)
    expectColor(colors[0], '#C1792E') // normales
    expectColor(colors[1], '#6B7280') // boîte
    expectColor(colors[2], '#A8A29E') // grille
    expectColor(colors[3], '#DC2626') // axe X : rouge
    expectColor(colors[4], '#16A34A') // axe Y : vert
    expectColor(colors[5], '#2563EB') // axe Z : bleu
  })

  it('les aides de l\'objet tournent avec lui (même matrice de modèle), la grille et les axes restent dans le monde (identité)', () => {
    const s = setup({ showNormals: true, showBoundingBox: true, showGrid: true, showAxes: true })

    s.renderer.draw(0.5)

    const rotation = Array.from(rotationY(0.5))
    const world = Array.from(identity())
    // Dans l'ordre de dessin : normales, boîte (objet), grille, X, Y, Z (monde).
    expect(lineUniform(s, 'uModel')).toEqual([rotation, rotation, world, world, world, world])
  })

  it('la boîte et les normales sont calculées sur le maillage normalisé (les coins sont à ±1, pas aux coordonnées d\'origine)', () => {
    const big = createCubeGeometry(500)
    const s = setup({ showBoundingBox: true }, {}, big)

    s.renderer.draw(0)

    expect(s.attributeBindings().at(-1)!.data).toEqual(Array.from(boundingBoxSegments(normalizeToUnitBox(big))))
    expect(Math.max(...s.attributeBindings().at(-1)!.data)).toBe(1)
  })

  it('les normales d\'un gros maillage sont échantillonnées : jamais plus de 4 000 segments (ici 5 151 sommets, un sur deux)', () => {
    const dense = createSphere(100, 50) // 101 x 51 = 5 151 sommets
    const s = setup({ showNormals: true }, {}, dense)

    s.renderer.draw(0)

    const [normals] = lineDraws(s)
    expect(normals!.count / 2).toBe(Math.ceil(5151 / 2)) // 2 576 segments
    expect(normals!.count / 2).toBeLessThanOrEqual(4000)
  })

  it('une aide n\'est créée qu\'au premier besoin et gardée ensuite (cocher, décocher, recocher : un seul envoi)', () => {
    const s = setup()
    s.renderer.draw(0)
    const buffers = s.mocks.createBuffer.mock.calls.length

    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, showGrid: true })
    s.renderer.draw(0)
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, showGrid: false })
    s.renderer.draw(0)
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, showGrid: true })
    s.renderer.draw(0)

    expect(s.mocks.createBuffer.mock.calls.length - buffers).toBe(1)
  })

  it('une aide décochée n\'est plus dessinée', () => {
    const s = setup({ showAxes: true })
    s.renderer.draw(0)
    s.clearDraws()

    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, showAxes: false })
    s.renderer.draw(0)

    expect(lineDraws(s)).toHaveLength(0)
  })
})

describe('les deux programmes reçoivent les mêmes matrices', () => {
  it('à la création : même vue et même projection dans le programme de l\'objet et celui des lignes', () => {
    const s = setup()

    expect(lineUniform(s, 'uView')).toEqual(meshUniform(s, 'uView'))
    expect(lineUniform(s, 'uProjection')).toEqual(meshUniform(s, 'uProjection'))
    expect(lineUniform(s, 'uView')).toHaveLength(1)
    expect(lineUniform(s, 'uProjection')).toHaveLength(1)
  })

  it('setCamera met à jour les DEUX programmes avec la même matrice de vue', () => {
    const s = setup()

    s.renderer.setCamera({ azimuth: 1, elevation: 0.2, distance: 7 })

    expect(lineUniform(s, 'uView')).toHaveLength(2)
    expect(lineUniform(s, 'uView')).toEqual(meshUniform(s, 'uView'))
    expect(lineUniform(s, 'uView').at(-1)).not.toEqual(lineUniform(s, 'uView')[0]) // et elle a bien changé
  })

  it('setViewport met à jour les DEUX programmes avec la même projection', () => {
    const s = setup()

    s.renderer.setViewport(800, 400)

    expect(lineUniform(s, 'uProjection')).toHaveLength(2)
    expect(lineUniform(s, 'uProjection')).toEqual(meshUniform(s, 'uProjection'))
    expect(lineUniform(s, 'uProjection').at(-1)).not.toEqual(lineUniform(s, 'uProjection')[0])
  })

  it('une taille invalide ne touche à aucun des deux programmes', () => {
    const s = setup()
    const before = s.uniformHistory('uProjection').length

    expect(() => s.renderer.setViewport(0, 100)).toThrow(RangeError)

    expect(s.uniformHistory('uProjection')).toHaveLength(before)
  })

  it('tout uniform est envoyé pendant que SON programme est actif (useProgram avant chaque envoi), quoi qu\'on fasse', () => {
    const s = setup({ displayMode: 'solid-wireframe', showNormals: true, showGrid: true, showAxes: true })

    s.renderer.setViewport(640, 480)
    s.renderer.setCamera({ azimuth: 2, elevation: -0.3, distance: 4 })
    s.renderer.setLighting({ ...DEFAULT_LIGHTING, model: 'gaussian' })
    s.renderer.draw(0.4)
    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'wireframe', showBoundingBox: true })
    s.renderer.draw(0.8)
    s.renderer.setMesh(createPlane())
    s.renderer.draw(1.2)

    const names = ['uModel', 'uView', 'uProjection', 'uNormalMatrix', 'uColor', 'uCameraPosition', 'uLightingModel']
    for (const name of names) {
      const calls = s.uniformHistory(name)
      expect(calls.length, name).toBeGreaterThan(0)
      expect(calls.every((call) => call.program === call.owner), name).toBe(true)
    }
  })
})

describe('échec de création d\'une aide : repli sur l\'affichage plein, l\'erreur remonte par le callback', () => {
  // Le maillage (cube) fait les appels 1 à 3 à bufferData : la première aide fait le 4e.
  const FIRST_OVERLAY_FAILS: FakeGlOptions = { bufferDataError: { call: 4, code: OUT_OF_MEMORY } }

  it('fil de fer seul : l\'erreur ne casse pas le dessin, l\'objet plein est dessiné à la place', () => {
    const s = setup({ displayMode: 'wireframe' }, FIRST_OVERLAY_FAILS)

    expect(() => s.renderer.draw(0)).not.toThrow()

    expect(s.draws().map((call) => [call.call, call.mode, call.count])).toEqual([['drawElements', s.gl.TRIANGLES, 36]])
  })

  it('prévient par le callback : l\'erreur du GPU et la partie des options remise à « plein »', () => {
    const s = setup({ displayMode: 'wireframe' }, FIRST_OVERLAY_FAILS)

    s.renderer.draw(0)

    expect(s.onOverlayError).toHaveBeenCalledOnce()
    const [error, reset] = s.onOverlayError.mock.calls[0]!
    expect((error as Error).message).toMatch(/Mémoire graphique insuffisante/)
    expect(reset).toEqual({ displayMode: 'solid' })
  })

  it('ne fuit rien : les ressources de l\'arête ratée sont libérées', () => {
    const s = setup({ displayMode: 'wireframe' }, FIRST_OVERLAY_FAILS)

    s.renderer.draw(0)

    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
  })

  it('les images suivantes restent en plein et ne réessaient pas à chaque image', () => {
    const s = setup({ displayMode: 'wireframe' }, FIRST_OVERLAY_FAILS)
    s.renderer.draw(0)
    const buffers = s.mocks.createBuffer.mock.calls.length
    s.clearDraws()

    s.renderer.draw(0.1)
    s.renderer.draw(0.2)

    expect(s.mocks.createBuffer.mock.calls.length).toBe(buffers)
    expect(s.onOverlayError).toHaveBeenCalledOnce()
    expect(s.draws().map((call) => call.call)).toEqual(['drawElements', 'drawElements'])
  })

  it('plein ET fil de fer : l\'image qui échoue est dessinée plein SANS polygon offset (plus d\'arêtes à protéger)', () => {
    const s = setup({ displayMode: 'solid-wireframe' }, FIRST_OVERLAY_FAILS)

    s.renderer.draw(0)

    expect(s.draws()).toEqual([
      { call: 'drawElements', mode: s.gl.TRIANGLES, count: 36, program: s.meshProgram, polygonOffsetFill: false },
    ])
    expect(s.mocks.polygonOffset).not.toHaveBeenCalled()
  })

  it('l\'utilisateur peut réessayer : choisir de nouveau le fil de fer relance la création (qui réussit cette fois)', () => {
    const s = setup({ displayMode: 'wireframe' }, FIRST_OVERLAY_FAILS)
    s.renderer.draw(0)
    s.clearDraws()

    s.renderer.setViewOptions({ ...DEFAULT_VIEW_OPTIONS, displayMode: 'wireframe' })
    s.renderer.draw(0)

    expect(s.draws().map((call) => [call.call, call.count])).toEqual([['drawArrays', 36]])
    expect(s.onOverlayError).toHaveBeenCalledOnce()
  })

  it('une autre aide qui échoue (les normales) est simplement décochée, les suivantes fonctionnent', () => {
    const s = setup({ showNormals: true, showBoundingBox: true }, FIRST_OVERLAY_FAILS)

    s.renderer.draw(0)

    expect(s.onOverlayError).toHaveBeenCalledOnce()
    expect(s.onOverlayError.mock.calls[0]![1]).toEqual({ showNormals: false })
    // Seule la boîte (12 segments) est dessinée ; l'objet plein aussi.
    expect(s.draws().map((call) => [call.call, call.count])).toEqual([
      ['drawElements', 36],
      ['drawArrays', 24],
    ])
  })

  it('sans callback, le repli se fait quand même (et rien ne plante)', () => {
    const fake = createFakeGl(FIRST_OVERLAY_FAILS)
    const renderer = createMeshRenderer(fake.gl, cube, DEFAULT_LIGHTING, DEFAULT_CAMERA, {
      ...DEFAULT_VIEW_OPTIONS,
      displayMode: 'wireframe',
    })

    expect(() => renderer.draw(0)).not.toThrow()

    expect(fake.draws().map((call) => call.call)).toEqual(['drawElements'])
  })

  it('un contexte qui ne fournit plus de buffer (null) donne le même repli', () => {
    const s = setup({ displayMode: 'wireframe' })
    s.mocks.createBuffer.mockReturnValue(null)

    expect(() => s.renderer.draw(0)).not.toThrow()

    expect(s.onOverlayError).toHaveBeenCalledOnce()
    expect((s.onOverlayError.mock.calls[0]![0] as Error).message).toMatch(/buffer/)
    expect(s.draws().map((call) => call.call)).toEqual(['drawElements'])
  })

  it('une aide à plusieurs séries qui échoue à mi-chemin (les axes, 3e série) libère les séries déjà créées', () => {
    // Le maillage fait les appels 1 à 3 à bufferData, les axes les 4 (X), 5 (Y) et 6 (Z) : le dernier échoue.
    const s = setup({ showAxes: true }, { bufferDataError: { call: 6, code: OUT_OF_MEMORY } })

    s.renderer.draw(0)

    // Les séries X et Y, déjà envoyées, ont été supprimées avec celle qui a échoué : il ne reste que le maillage.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
    expect(s.onOverlayError).toHaveBeenCalledOnce()
    expect(s.onOverlayError.mock.calls[0]![1]).toEqual({ showAxes: false })
    // Aucun axe à moitié dessiné : seulement l'objet.
    expect(s.draws().map((call) => call.call)).toEqual(['drawElements'])
  })

  describe('contexte perdu pendant la création d\'une aide', () => {
    // Le GPU a repris le contexte : la création échoue, mais ce n'est pas la faute de l'aide.
    const LOST_DURING_CREATION: FakeGlOptions = { bufferDataError: { call: 4, code: OUT_OF_MEMORY } }

    it('ne change pas les options, ne prévient personne et ne mémorise rien (la restauration recréera tout)', () => {
      const s = setup({ displayMode: 'wireframe' }, LOST_DURING_CREATION)
      s.setContextLost(true)

      expect(() => s.renderer.draw(0)).not.toThrow()

      expect(s.onOverlayError).not.toHaveBeenCalled()
      expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 }) // ce qui était créé est libéré
    })

    it('les options sont gardées : sans perte de contexte, l\'image suivante réessaie et dessine le fil de fer', () => {
      const s = setup({ displayMode: 'wireframe' }, LOST_DURING_CREATION)
      s.setContextLost(true)
      s.renderer.draw(0)
      s.setContextLost(false)
      s.clearDraws()

      s.renderer.draw(0.1)

      // Le mode est resté « Fil de fer » (rien n'a été remis en plein) et la 2e tentative réussit (seul l'appel 4 échouait).
      expect(s.draws().map((call) => [call.call, call.count])).toEqual([['drawArrays', 36]])
      expect(s.onOverlayError).not.toHaveBeenCalled()
    })

    it('une panne qui n\'est pas une perte de contexte reste signalée (le test précédent n\'est pas un faux positif)', () => {
      const s = setup({ displayMode: 'wireframe' }, LOST_DURING_CREATION)

      s.renderer.draw(0)

      expect(s.onOverlayError).toHaveBeenCalledOnce()
    })
  })

  it('un rappel d\'erreur qui lève une exception est journalisé et ignoré : le dessin continue, le repli est fait', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = setup({ displayMode: 'wireframe' }, { bufferDataError: { call: 4, code: OUT_OF_MEMORY } })
    s.onOverlayError.mockImplementation(() => {
      throw new Error('rappel défaillant')
    })

    expect(() => s.renderer.draw(0)).not.toThrow()

    expect(consoleError).toHaveBeenCalled()
    expect(s.draws().map((call) => call.call)).toEqual(['drawElements']) // l'objet plein est dessiné quand même
    // Le repli est bien fait : l'image suivante ne réessaie pas.
    s.renderer.draw(0.1)
    expect(s.onOverlayError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})

describe('création, contexte restauré et libération', () => {
  it('un renderer recréé après une perte de contexte reçoit les options courantes et recrée ses séries au premier dessin', () => {
    const s = setup({ displayMode: 'solid-wireframe', showGrid: true, showAxes: true })
    s.renderer.draw(0)
    s.loseAllResources() // le GPU a tout détruit, sans delete*

    const restored = createMeshRenderer(s.gl, cube, DEFAULT_LIGHTING, DEFAULT_CAMERA, {
      ...DEFAULT_VIEW_OPTIONS,
      displayMode: 'solid-wireframe',
      showGrid: true,
      showAxes: true,
    })
    // Au départ, juste le maillage et les deux programmes : les séries viennent avec le premier dessin.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 3, vertexArray: 1 })
    s.clearDraws()
    restored.draw(0)

    // arêtes + grille + trois axes : cinq séries de plus, et tous les dessins sont revenus.
    expect(s.liveCounts()).toEqual({ shader: 0, program: 2, buffer: 8, vertexArray: 6 })
    expect(s.draws().map((call) => [call.call, call.count])).toEqual([
      ['drawElements', 36],
      ['drawArrays', 36],
      ['drawArrays', 52],
      ['drawArrays', 2],
      ['drawArrays', 2],
      ['drawArrays', 2],
    ])
    expect(s.isEnabled(s.gl.POLYGON_OFFSET_FILL)).toBe(false)
  })

  it('dispose libère tout : programmes, maillage et toutes les séries de lignes', () => {
    const s = setup({
      displayMode: 'solid-wireframe',
      showNormals: true,
      showBoundingBox: true,
      showGrid: true,
      showAxes: true,
    })
    s.renderer.draw(0)
    expect(s.liveCounts().vertexArray).toBeGreaterThan(1)

    s.renderer.dispose()

    expect(s.liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('libère le premier programme si celui des lignes ne se compile pas', () => {
    // Le premier programme est créé (vertex puis fragment de l'objet), puis celui des lignes échoue.
    const fake = createFakeGl()
    let vertexShaders = 0
    const original = fake.mocks.getShaderParameter.getMockImplementation()!
    fake.mocks.getShaderParameter.mockImplementation((shader: object) => {
      const resource = shader as { shaderType?: number }
      if (resource.shaderType === fake.gl.VERTEX_SHADER && ++vertexShaders === 2) return false
      return original(shader)
    })

    expect(() => createMeshRenderer(fake.gl, cube)).toThrow(/compilation/)

    expect(fake.liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })

  it('libère les deux programmes si le maillage initial ne peut pas être envoyé', () => {
    const fake = createFakeGl({ failCreate: 'buffer' })

    expect(() => createMeshRenderer(fake.gl, cube)).toThrow(/buffer/)

    expect(fake.liveCounts()).toEqual({ shader: 0, program: 0, buffer: 0, vertexArray: 0 })
  })
})
