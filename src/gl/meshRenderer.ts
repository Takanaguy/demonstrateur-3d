/**
 * Dessine un maillage éclairé avec WebGL2 (un cube, une sphère, un fichier OBJ...) : c'est ici que
 * se rejoignent les maths (`core/`), les shaders et les buffers. Aucune dépendance à React : le
 * composant ne fait que l'appeler.
 *
 * Le pipeline, dans l'ordre :
 * 1. Les SHADERS (mesh.vert, mesh.frag) sont compilés et liés en un programme.
 * 2. Les BUFFERS (positions, normales, indices) sont copiés sur le GPU et rangés dans un VAO.
 * 3. Les UNIFORMS (matrices, position de la caméra, couleur, réglages de la lumière) sont envoyés au
 *    programme.
 * 4. `drawElements` lance le dessin : le GPU exécute le vertex shader sur chaque sommet, rasterise
 *    les triangles en pixels, puis exécute le fragment shader sur chaque pixel.
 */

import { parseHexColor } from '../core/color'
import {
  CAMERA_TARGET,
  CAMERA_UP,
  DEFAULT_CAMERA,
  cameraPosition,
  sanitizeCamera,
  type OrbitCamera,
} from '../core/camera'
import { lookAt, normalMatrix, perspective, rotationY, type Mat4 } from '../core/mat4'
import { DEFAULT_LIGHTING, sanitizeLighting, type LightingModel, type LightingSettings } from '../core/lighting'
import { normalizeToUnitBox, type Mesh } from '../core/mesh'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
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

/**
 * Numéro de chaque modèle d'éclairage, tel que le lit le fragment shader (uniform entier
 * `uLightingModel`). Ce sont les constantes MODEL_* de mesh.frag. Un `Record` oblige TypeScript à
 * protester si un modèle est ajouté sans numéro.
 */
const MODEL_NUMBER: Record<LightingModel, number> = {
  lambert: 0,
  'blinn-phong': 1,
  gaussian: 2,
}

/** Les noms des uniforms déclarés dans les shaders. */
const UNIFORM_NAMES = [
  'uModel',
  'uView',
  'uProjection',
  'uNormalMatrix',
  'uColor',
  'uCameraPosition',
  'uLightingModel',
  'uLightPosition',
  'uLightColor',
  'uAmbient',
  'uSpecularIntensity',
  'uShininess',
  'uGaussianMean',
  'uGaussianStdDev',
] as const
type UniformName = (typeof UNIFORM_NAMES)[number]

export interface MeshRenderer {
  /** Adapte la zone de dessin et la projection à la taille du tampon de dessin, en pixels. */
  setViewport: (width: number, height: number) => void
  /** Dessine une image, l'objet tourné de `angleY` radians autour de l'axe vertical. */
  draw: (angleY: number) => void
  /**
   * Place la caméra. La caméra est d'abord assainie (bornée, jamais de NaN), puis la matrice de vue ET
   * la position de l'oeil (que le fragment shader utilise pour le reflet) sont recalculées ensemble,
   * à partir de la même position : elles ne peuvent pas se contredire. Le prochain dessin les utilise.
   */
  setCamera: (camera: OrbitCamera) => void
  /** Change les options de vue (face culling...). Le prochain dessin les utilise. */
  setViewOptions: (options: ViewOptions) => void
  /**
   * Remplace le maillage affiché. Le nouveau est créé AVANT de supprimer l'ancien : si sa création
   * échoue (mémoire GPU, contexte perdu), l'erreur est relancée et l'ancien reste affiché.
   */
  setMesh: (mesh: Mesh) => void
  /**
   * Change l'éclairage (modèle, position et couleur de la lumière, reflet...). Les réglages sont
   * d'abord assainis (bornés, jamais de NaN) puis envoyés au GPU ; le prochain dessin les utilise.
   */
  setLighting: (settings: LightingSettings) => void
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
 * À rappeler après une perte de contexte : toutes les ressources GPU ont alors disparu, et avec elles
 * la caméra, les options de vue et l'éclairage envoyés. L'appelant redonne donc les DERNIERS réglages
 * par les paramètres (valeurs par défaut sinon).
 */
export function createMeshRenderer(
  gl: WebGL2RenderingContext,
  initialMesh: Mesh,
  initialLighting: LightingSettings = DEFAULT_LIGHTING,
  initialCamera: OrbitCamera = DEFAULT_CAMERA,
  initialViewOptions: ViewOptions = DEFAULT_VIEW_OPTIONS,
): MeshRenderer {
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

  // --- Uniform qui ne change jamais : envoyé une seule fois. Un uniform garde sa valeur dans le
  // programme jusqu'à ce qu'on la remplace.
  gl.useProgram(program)
  gl.uniform3fv(uniforms.uColor, parseHexColor(OBJECT_COLOR))

  // --- Caméra : elle bouge à la souris, donc elle a sa propre fonction, appelée ici au départ puis
  // par `setCamera`. Elle refait `useProgram` car elle peut être appelée à n'importe quel moment.
  const applyCamera = (camera: OrbitCamera) => {
    // Assainie AVANT tout calcul : un NaN dans la matrice de vue ferait disparaître l'objet sans erreur.
    const position = cameraPosition(sanitizeCamera(camera))
    // Calculée avant de toucher au GPU : si `lookAt` levait une erreur, aucun uniform ne serait à
    // moitié envoyé. (Elle ne le peut pas ici : l'élévation bornée écarte la caméra des pôles.)
    const view = lookAt(position, CAMERA_TARGET, CAMERA_UP)
    gl.useProgram(program)
    // `false` : la matrice est déjà en colonnes-majeures, WebGL n'a pas à la transposer.
    gl.uniformMatrix4fv(uniforms.uView, false, view)
    // La position de l'oeil vient du MÊME calcul que la matrice de vue : le fragment shader s'en sert
    // pour la direction vers l'oeil (le reflet), qui serait fausse si elle restait celle d'avant.
    gl.uniform3fv(uniforms.uCameraPosition, position)
  }
  applyCamera(initialCamera)

  // --- Options de vue. Refaites à la création : un contexte restauré repart avec le culling désactivé.
  const applyViewOptions = (options: ViewOptions) => {
    if (options.backfaceCulling) {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK) // ne pas dessiner les triangles vus par l'arrière (c'est la valeur par défaut, rappelée)
    } else {
      // Culling DÉSACTIVÉ : un plan, ou un fichier OBJ qui n'est pas un volume fermé, doit être
      // visible des deux côtés. Le fragment shader retourne alors la normale des faces vues par
      // l'arrière (gl_FrontFacing) pour les éclairer juste ; avec le culling, ces faces ne sont plus
      // dessinées et ce retournement ne sert plus à rien.
      gl.disable(gl.CULL_FACE)
    }
  }
  applyViewOptions(initialViewOptions)

  // --- Éclairage : il change quand l'utilisateur touche aux réglages, donc il a sa propre fonction,
  // appelée ici au départ puis par `setLighting`. Elle refait `useProgram` car elle peut être
  // appelée à n'importe quel moment, quel que soit le programme actif.
  const applyLighting = (settings: LightingSettings) => {
    // Assaini AVANT tout envoi : un NaN envoyé à un uniform ne produit aucune erreur, seulement des
    // pixels faux dans tout l'objet.
    const safe = sanitizeLighting(settings)
    gl.useProgram(program)
    gl.uniform1i(uniforms.uLightingModel, MODEL_NUMBER[safe.model]) // entier : 1i et non 1f
    gl.uniform3fv(uniforms.uLightPosition, safe.position)
    gl.uniform3fv(uniforms.uLightColor, parseHexColor(safe.color))
    gl.uniform1f(uniforms.uAmbient, safe.ambient)
    gl.uniform1f(uniforms.uSpecularIntensity, safe.specular)
    gl.uniform1f(uniforms.uShininess, safe.shininess)
    gl.uniform1f(uniforms.uGaussianMean, safe.gaussianMean)
    gl.uniform1f(uniforms.uGaussianStdDev, safe.gaussianStdDev)
  }
  applyLighting(initialLighting)

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
      // L'objet tourne seulement sur lui-même autour de Y. L'inclinaison d'avant vient maintenant de
      // la caméra (son élévation) : on ne penche plus l'objet, on change le point de vue.
      const model = rotationY(angleY)

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

    setLighting: applyLighting,

    setCamera: applyCamera,

    setViewOptions: applyViewOptions,

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
