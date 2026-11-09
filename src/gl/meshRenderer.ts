/**
 * Dessine un maillage éclairé avec WebGL2 (un cube, une sphère, un fichier OBJ...) : c'est ici que
 * se rejoignent les maths (`core/`), les shaders et les buffers. Aucune dépendance à React : le
 * composant ne fait que l'appeler.
 *
 * Le pipeline, dans l'ordre :
 * 1. Les SHADERS (mesh.vert, mesh.frag) sont compilés et liés en un programme.
 * 2. Les BUFFERS (positions, normales, indices) sont copiés sur le GPU et rangés dans un VAO.
 * 3. Les UNIFORMS (matrices, couleur, lumière) sont envoyés au programme.
 * 4. `drawElements` lance le dessin : le GPU exécute le vertex shader sur chaque sommet, rasterise
 *    les triangles en pixels, puis exécute le fragment shader sur chaque pixel.
 */

import { parseHexColor } from '../core/color'
import {
  lookAt,
  multiply,
  normalMatrix,
  perspective,
  rotationX,
  rotationY,
  type Mat4,
} from '../core/mat4'
import { normalizeToUnitBox, type Mesh } from '../core/mesh'
import { normalize, type Vec3 } from '../core/vec3'
import { createIndexedMesh, type IndexedMesh } from './buffers'
import { createProgram } from './shader'
import fragmentSource from './shaders/mesh.frag?raw'
import vertexSource from './shaders/mesh.vert?raw'

const BACKGROUND_COLOR = '#F7F4EE'
const OBJECT_COLOR = '#2E5D7C'

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
 * Inclinaison fixe de l'objet autour de X. Vu pile de face, un cube ressemble à un carré plat, et
 * un plan horizontal à un trait. C'est la même valeur que dans la première version du démonstrateur.
 */
const TILT = 0.4

/** Les noms des uniforms déclarés dans les shaders. */
const UNIFORM_NAMES = ['uModel', 'uView', 'uProjection', 'uNormalMatrix', 'uColor', 'uLightDirection'] as const
type UniformName = (typeof UNIFORM_NAMES)[number]

export interface MeshRenderer {
  /** Adapte la zone de dessin et la projection à la taille du tampon de dessin, en pixels. */
  setViewport: (width: number, height: number) => void
  /** Dessine une image, l'objet tourné de `angleY` radians autour de l'axe vertical. */
  draw: (angleY: number) => void
  /**
   * Remplace le maillage affiché. Le nouveau est créé AVANT de supprimer l'ancien : si sa création
   * échoue (mémoire GPU, contexte perdu), l'erreur est relancée et l'ancien reste affiché.
   */
  setMesh: (mesh: Mesh) => void
  /** Supprime le programme et le maillage (buffers + VAO). */
  dispose: () => void
}

/**
 * Normalise le maillage dans la boîte unité (centré, côté 2) puis le copie sur le GPU. Cette
 * normalisation est faite ici, à l'envoi, pour que TOUT ce qui est affiché tienne dans la vue
 * quelle que soit son unité ou sa position d'origine ; le maillage d'origine, lui, n'est pas modifié
 * (les statistiques affichées restent celles du fichier).
 */
function uploadMesh(gl: WebGL2RenderingContext, mesh: Mesh): IndexedMesh {
  const { positions, normals, indices } = normalizeToUnitBox(mesh)
  return createIndexedMesh(gl, {
    attributes: [
      { location: 0, size: 3, data: positions }, // aPosition
      { location: 1, size: 3, data: normals }, // aNormal
    ],
    indices,
  })
}

/**
 * Crée tout ce qu'il faut pour dessiner `initialMesh` sur ce contexte. Lève une erreur lisible (avec le
 * journal du compilateur) si les shaders sont refusés ; rien ne reste alors alloué.
 *
 * À rappeler après une perte de contexte : toutes les ressources GPU ont alors disparu.
 */
export function createMeshRenderer(gl: WebGL2RenderingContext, initialMesh: Mesh): MeshRenderer {
  const program = createProgram(gl, vertexSource, fragmentSource)

  let current: IndexedMesh
  let uniforms: Record<UniformName, WebGLUniformLocation>
  try {
    uniforms = findUniforms(gl, program)
    current = uploadMesh(gl, initialMesh)
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  }

  // --- Réglages d'état. Ils sont faits ici (et pas une fois pour toutes) car un contexte restauré
  // après une perte repart avec les réglages par défaut.
  const [r, g, b] = parseHexColor(BACKGROUND_COLOR)
  gl.clearColor(r, g, b, 1) // couleur de fond, appliquée par gl.clear
  gl.enable(gl.DEPTH_TEST) // le test de profondeur : un pixel proche cache un pixel lointain
  // Face culling DÉSACTIVÉ (réglage par défaut, rappelé ici pour que ce soit un choix lisible) : un
  // plan, ou un fichier OBJ qui n'est pas un volume fermé, doit être visible des deux côtés. Le
  // fragment shader retourne la normale des faces vues par l'arrière pour les éclairer juste.
  gl.disable(gl.CULL_FACE)

  // --- Uniforms qui ne changent pas pendant l'animation : envoyés une seule fois. Un uniform garde
  // sa valeur dans le programme jusqu'à ce qu'on la remplace.
  gl.useProgram(program)
  const view = lookAt(CAMERA_POSITION, CAMERA_TARGET, CAMERA_UP)
  // `false` : la matrice est déjà en colonnes-majeures, WebGL n'a pas à la transposer.
  gl.uniformMatrix4fv(uniforms.uView, false, view)
  gl.uniform3fv(uniforms.uColor, parseHexColor(OBJECT_COLOR))
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
      // L'aspect de la projection suit la forme du canvas, sinon l'objet serait étiré.
      const projection = perspective(FIELD_OF_VIEW, width / height, NEAR_PLANE, FAR_PLANE)
      // Le viewport dit au GPU quelle partie du canvas recevoir l'image (ici : tout). Sans lui,
      // le dessin garderait la taille initiale après un redimensionnement.
      gl.viewport(0, 0, width, height)
      setProjection(projection)
    },

    draw(angleY) {
      // L'objet tourne sur lui-même autour de Y (appliqué en premier), puis toute la figure est
      // inclinée autour de X.
      const model = multiply(rotationX(TILT), rotationY(angleY))

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT) // efface l'image précédente et les profondeurs
      gl.useProgram(program)
      gl.uniformMatrix4fv(uniforms.uModel, false, model)
      gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, normalMatrix(model))
      current.draw()
    },

    setMesh(mesh) {
      // Le nouveau maillage est créé d'abord : s'il échoue (fabrique `null` ou erreur lue par
      // `getError`, comme OUT_OF_MEMORY, voir createIndexedMesh), `current` n'a pas été touché.
      const next = uploadMesh(gl, mesh)
      current.dispose() // libère l'ancien VAO et ses buffers, que le ramasse-miettes ne verrait pas
      current = next
    },

    dispose() {
      current.dispose()
      // Supprime aussi les shaders encore attachés (voir createProgram).
      gl.deleteProgram(program)
    },
  }
}

/**
 * Retrouve l'emplacement de chaque uniform. Un nom introuvable est une faute de frappe (ou un
 * uniform que le compilateur a jugé inutile et retiré) : on le signale tout de suite, car WebGL
 * ignorerait sinon sans bruit l'envoi de la valeur et l'objet s'afficherait faux.
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
