import fragmentSource from './mesh.frag?raw'
import vertexSource from './mesh.vert?raw'

// Le compilateur WebGL n'existe pas dans jsdom : ces tests vérifient les règles que le compilateur
// imposerait et le contrat avec le code TypeScript (noms des entrées et des uniforms).

// Git peut convertir les fichiers en CRLF sur Windows : les tests de contenu travaillent sur un
// texte aux fins de ligne normalisées, pour ne pas dépendre de la machine.
const fragment = fragmentSource.replace(/\r\n/g, '\n')
const vertex = vertexSource.replace(/\r\n/g, '\n')

describe('shaders du maillage (texte GLSL)', () => {
  it.each([
    ['mesh.vert', vertexSource],
    ['mesh.frag', fragmentSource],
  ])('%s commence par #version 300 es, tout en première ligne (sinon la compilation échoue)', (_name, source) => {
    // `^` sans drapeau `m` : rien avant `#version` (ni BOM, ni ligne vide). `\r?\n` accepte les deux
    // fins de ligne, car Git peut convertir les fichiers en CRLF sur Windows.
    expect(source).toMatch(/^#version 300 es\r?\n/)
  })

  it('le fragment shader déclare la précision highp (acos près de 1 est trop imprécis en mediump)', () => {
    expect(fragment).toMatch(/^precision highp float;$/m)
    expect(fragment).not.toContain('precision mediump')
  })

  it('le vertex shader lit la position en location 0 et la normale en location 1 (comme les buffers)', () => {
    expect(vertex).toMatch(/layout\(location = 0\) in vec3 aPosition;/)
    expect(vertex).toMatch(/layout\(location = 1\) in vec3 aNormal;/)
  })

  it.each([
    ['uModel', 'mat4', vertex],
    ['uView', 'mat4', vertex],
    ['uProjection', 'mat4', vertex],
    ['uNormalMatrix', 'mat3', vertex],
    ['uColor', 'vec3', fragment],
    ['uCameraPosition', 'vec3', fragment],
    ['uLightingModel', 'int', fragment],
    ['uLightPosition', 'vec3', fragment],
    ['uLightColor', 'vec3', fragment],
    ['uAmbient', 'float', fragment],
    ['uSpecularIntensity', 'float', fragment],
    ['uShininess', 'float', fragment],
    ['uGaussianMean', 'float', fragment],
    ['uGaussianStdDev', 'float', fragment],
  ])('déclare « uniform %s » (%s) dans le bon shader', (name, type, source) => {
    expect(source).toContain(`uniform ${type} ${name};`)
  })

  it("le fragment shader n'a plus la direction de lumière fixe d'avant", () => {
    expect(fragment).not.toContain('uLightDirection')
  })

  it('le fragment shader retourne la normale des faces vues par l\'arrière (le culling est désactivé)', () => {
    expect(fragment).toMatch(/if \(!gl_FrontFacing\) normal = -normal;/)
  })

  it.each(['vNormal', 'vWorldPosition'])(
    'la sortie %s du vertex shader correspond à l\'entrée du fragment shader (même nom, même type)',
    (name) => {
      expect(vertex).toMatch(new RegExp(`out vec3 ${name};`))
      expect(fragment).toMatch(new RegExp(`in vec3 ${name};`))
    },
  )

  it('le vertex shader calcule la position dans le monde avec la matrice du modèle', () => {
    expect(vertex).toMatch(/uModel \* vec4\(aPosition, 1\.0\)/)
    expect(vertex).toMatch(/vWorldPosition = \w+\.xyz;/)
  })

  it('les numéros des modèles du fragment shader sont ceux que le renderer envoie (0, 1, 2)', () => {
    expect(fragment).toContain('const int MODEL_LAMBERT = 0;')
    expect(fragment).toContain('const int MODEL_BLINN_PHONG = 1;')
    expect(fragment).toContain('const int MODEL_GAUSSIAN = 2;')
  })

  it("le reflet n'existe que si la face reçoit la lumière (N·L > 0), et jamais pour Lambert", () => {
    expect(fragment).toMatch(/uLightingModel != MODEL_LAMBERT && nDotL > 0\.0/)
  })

  it('le demi-vecteur H nul est écarté avant normalize (sinon NaN quand L et V sont opposés)', () => {
    expect(fragment).toContain('length(halfSum) > 0.0001')
  })

  it('le fragment shader contient les formules du reflet et renvoie vers leur référence testable', () => {
    expect(fragment).toContain('pow(max(nDotH, 0.0), uShininess)')
    expect(fragment).toContain('acos(clamp(nDotH, -1.0, 1.0))')
    expect(fragment).toContain('exp(-(offset * offset) / (2.0 * uGaussianStdDev * uGaussianStdDev))')
    expect(fragment).toContain('blinnPhongSpecular')
    expect(fragment).toContain('gaussianSpecular')
  })

  it('la couleur finale est bornée à 1 explicitement', () => {
    expect(fragment).toMatch(/min\(ambientPart \+ diffusePart \+ specularPart, vec3\(1\.0\)\)/)
  })
})
