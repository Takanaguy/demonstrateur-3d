import fragmentSource from './cube.frag?raw'
import vertexSource from './cube.vert?raw'

// Le compilateur WebGL n'existe pas dans jsdom : ces tests vérifient les règles que le compilateur
// imposerait et le contrat avec le code TypeScript (noms des entrées et des uniforms).

describe('shaders du cube (texte GLSL)', () => {
  it.each([
    ['cube.vert', vertexSource],
    ['cube.frag', fragmentSource],
  ])('%s commence par #version 300 es, tout en première ligne (sinon la compilation échoue)', (_name, source) => {
    // `^` sans drapeau `m` : rien avant `#version` (ni BOM, ni ligne vide). `\r?\n` accepte les deux
    // fins de ligne, car Git peut convertir les fichiers en CRLF sur Windows.
    expect(source).toMatch(/^#version 300 es\r?\n/)
  })

  it('le fragment shader déclare la précision des flottants (obligatoire en GLSL ES)', () => {
    expect(fragmentSource).toMatch(/^precision mediump float;$/m)
  })

  it('le vertex shader lit la position en location 0 et la normale en location 1 (comme les buffers)', () => {
    expect(vertexSource).toMatch(/layout\(location = 0\) in vec3 aPosition;/)
    expect(vertexSource).toMatch(/layout\(location = 1\) in vec3 aNormal;/)
  })

  it.each([
    ['uModel', 'mat4', vertexSource],
    ['uView', 'mat4', vertexSource],
    ['uProjection', 'mat4', vertexSource],
    ['uNormalMatrix', 'mat3', vertexSource],
    ['uColor', 'vec3', fragmentSource],
    ['uLightDirection', 'vec3', fragmentSource],
  ])('déclare « uniform %s » (%s) dans le bon shader', (name, type, source) => {
    expect(source).toContain(`uniform ${type} ${name};`)
  })

  it('la sortie du vertex shader correspond à l\'entrée du fragment shader (même nom, même type)', () => {
    expect(vertexSource).toMatch(/out vec3 vNormal;/)
    expect(fragmentSource).toMatch(/in vec3 vNormal;/)
  })
})
