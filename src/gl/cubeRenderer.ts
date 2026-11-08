/**
 * Dessine le cube éclairé avec WebGL2 : c'est ici que se rejoignent les maths (`core/`), les
 * shaders et les buffers. Aucune dépendance à React : le composant ne fait que l'appeler.
 *
 * Le pipeline, dans l'ordre :
 * 1. Les SHADERS (cube.vert, cube.frag) sont compilés et liés en un programme.
 * 2. Les BUFFERS (positions, normales, indices) sont copiés sur le GPU et rangés dans un VAO.
 * 3. Les UNIFORMS (matrices, couleur, lumière) sont envoyés au programme.
 * 4. `drawElements` lance le dessin : le GPU exécute le vertex shader sur chaque sommet, rasterise
 *    les triangles en pixels, puis exécute le fragment shader sur chaque pixel.
 */

import { parseHexColor } from '../core/color'
import { createCubeGeometry } from '../core/cube'
import {
  lookAt,
  multiply,
  normalMatrix,
  perspective,
  rotationX,
  rotationY,
  type Mat4,
} from '../core/mat4'
import { normalize, type Vec3 } from '../core/vec3'
import { createIndexedMesh } from './buffers'
import { createProgram } from './shader'
import fragmentSource from './shaders/cube.frag?raw'
import vertexSource from './shaders/cube.vert?raw'

const BACKGROUND_COLOR = '#F7F4EE'
const CUBE_COLOR = '#2E5D7C'
const CUBE_SIZE = 1.5

/** Ouverture verticale de la caméra : 45 degrés, convertis en radians. */
const FIELD_OF_VIEW = (45 * Math.PI) / 180
const NEAR_PLANE = 0.1
const FAR_PLANE = 100
const CAMERA_POSITION: Vec3 = [0, 0, 5]
const CAMERA_TARGET: Vec3 = [0, 0, 0]
const CAMERA_UP: Vec3 = [0, 1, 0]

/** Position de la lumière dans le monde. Elle est directionnelle : seule sa direction compte. */
const LIGHT_POSITION: Vec3 = [3, 4, 5]

/**
 * Inclinaison fixe du cube autour de X. Vu pile de face, un cube ressemble à un carré plat.
 * C'est la même valeur que dans la première version du démonstrateur.
 */
const TILT = 0.4

/** Les noms des uniforms déclarés dans les shaders. */
const UNIFORM_NAMES = ['uModel', 'uView', 'uProjection', 'uNormalMatrix', 'uColor', 'uLightDirection'] as const
type UniformName = (typeof UNIFORM_NAMES)[number]

export interface CubeRenderer {
  /** Adapte la zone de dessin et la projection à la taille du tampon de dessin, en pixels. */
  setViewport: (width: number, height: number) => void
  /** Dessine une image, le cube tourné de `angleY` radians autour de l'axe vertical. */
  draw: (angleY: number) => void
  /** Supprime le programme et le maillage (buffers + VAO). */
  dispose: () => void
}

/**
 * Crée tout ce qu'il faut pour dessiner le cube sur ce contexte. Lève une erreur lisible (avec le
 * journal du compilateur) si les shaders sont refusés ; rien ne reste alors alloué.
 *
 * À rappeler après une perte de contexte : toutes les ressources GPU ont alors disparu.
 */
export function createCubeRenderer(gl: WebGL2RenderingContext): CubeRenderer {
  const program = createProgram(gl, vertexSource, fragmentSource)

  let mesh: ReturnType<typeof createIndexedMesh>
  let uniforms: Record<UniformName, WebGLUniformLocation>
  try {
    uniforms = findUniforms(gl, program)
    const geometry = createCubeGeometry(CUBE_SIZE)
    mesh = createIndexedMesh(gl, {
      attributes: [
        { location: 0, size: 3, data: geometry.positions }, // aPosition
        { location: 1, size: 3, data: geometry.normals }, // aNormal
      ],
      indices: geometry.indices,
    })
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  }

  // --- Réglages d'état. Ils sont faits ici (et pas une fois pour toutes) car un contexte restauré
  // après une perte repart avec les réglages par défaut.
  const [r, g, b] = parseHexColor(BACKGROUND_COLOR)
  gl.clearColor(r, g, b, 1) // couleur de fond, appliquée par gl.clear
  gl.enable(gl.DEPTH_TEST) // le test de profondeur : un pixel proche cache un pixel lointain
  gl.enable(gl.CULL_FACE) // ne dessine pas les triangles vus par l'arrière : invisibles sur un cube plein
  gl.cullFace(gl.BACK) // ce sont bien les faces arrière qu'on écarte (réglage par défaut, explicite ici)
  gl.frontFace(gl.CCW) // une face « avant » a ses sommets dans le sens inverse des aiguilles d'une montre

  // --- Uniforms qui ne changent pas pendant l'animation : envoyés une seule fois. Un uniform garde
  // sa valeur dans le programme jusqu'à ce qu'on la remplace.
  gl.useProgram(program)
  const view = lookAt(CAMERA_POSITION, CAMERA_TARGET, CAMERA_UP)
  // `false` : la matrice est déjà en colonnes-majeures, WebGL n'a pas à la transposer.
  gl.uniformMatrix4fv(uniforms.uView, false, view)
  gl.uniform3fv(uniforms.uColor, parseHexColor(CUBE_COLOR))
  // Direction VERS la lumière, normalisée : le shader en fait un produit scalaire avec la normale.
  gl.uniform3fv(uniforms.uLightDirection, normalize(LIGHT_POSITION))

  const setProjection = (projection: Mat4) => {
    gl.useProgram(program)
    gl.uniformMatrix4fv(uniforms.uProjection, false, projection)
  }
  // Projection de départ (aspect 1) : définie avant que la taille réelle soit connue.
  setProjection(perspective(FIELD_OF_VIEW, 1, NEAR_PLANE, FAR_PLANE))

  return {
    setViewport(width, height) {
      // Calculée d'abord : une taille invalide lève ici, avant de toucher à l'état du GPU.
      // L'aspect de la projection suit la forme du canvas, sinon le cube serait étiré.
      const projection = perspective(FIELD_OF_VIEW, width / height, NEAR_PLANE, FAR_PLANE)
      // Le viewport dit au GPU quelle partie du canvas recevoir l'image (ici : tout). Sans lui,
      // le dessin garderait la taille initiale après un redimensionnement.
      gl.viewport(0, 0, width, height)
      setProjection(projection)
    },

    draw(angleY) {
      // Le cube tourne sur lui-même autour de Y (appliqué en premier), puis toute la figure est
      // inclinée autour de X.
      const model = multiply(rotationX(TILT), rotationY(angleY))

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT) // efface l'image précédente et les profondeurs
      gl.useProgram(program)
      gl.uniformMatrix4fv(uniforms.uModel, false, model)
      gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, normalMatrix(model))
      mesh.draw()
    },

    dispose() {
      mesh.dispose()
      // Supprime aussi les shaders encore attachés (voir createProgram).
      gl.deleteProgram(program)
    },
  }
}

/**
 * Retrouve l'emplacement de chaque uniform. Un nom introuvable est une faute de frappe (ou un
 * uniform que le compilateur a jugé inutile et retiré) : on le signale tout de suite, car WebGL
 * ignorerait sinon sans bruit l'envoi de la valeur et le cube s'afficherait faux.
 */
function findUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Record<UniformName, WebGLUniformLocation> {
  const locations = {} as Record<UniformName, WebGLUniformLocation>
  for (const name of UNIFORM_NAMES) {
    const location = gl.getUniformLocation(program, name)
    if (!location) throw new Error(`Uniform « ${name} » introuvable dans le programme.`)
    locations[name] = location
  }
  return locations
}
