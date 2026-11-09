/**
 * Dessine un maillage éclairé avec WebGL2 (un cube, une sphère, un fichier OBJ...) et ses aides en
 * traits (fil de fer, normales, boîte englobante, grille, axes) : c'est ici que se rejoignent les
 * maths (`core/`), les shaders et les buffers. Aucune dépendance à React : le composant ne fait que
 * l'appeler.
 *
 * Le pipeline, dans l'ordre :
 * 1. Les SHADERS (mesh.vert, mesh.frag) sont compilés et liés en un programme. Un SECOND programme,
 *    celui des lignes (line.vert, line.frag, voir lineRenderer.ts), dessine tout ce qui est en traits.
 * 2. Les BUFFERS (positions, normales, indices) sont copiés sur le GPU et rangés dans un VAO.
 * 3. Les UNIFORMS (matrices, position de la caméra, couleur, réglages de la lumière) sont envoyés au
 *    programme. Les deux programmes reçoivent les MÊMES matrices de vue et de projection.
 * 4. `drawElements` lance le dessin des surfaces : le GPU exécute le vertex shader sur chaque sommet,
 *    rasterise les triangles en pixels, puis exécute le fragment shader sur chaque pixel.
 * 5. Les traits sont dessinés ensuite (`drawArrays` avec `gl.LINES`), par-dessus les surfaces.
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
import { identity, lookAt, normalMatrix, perspective, rotationY, type Mat4 } from '../core/mat4'
import { DEFAULT_LIGHTING, sanitizeLighting, type LightingModel, type LightingSettings } from '../core/lighting'
import { normalizeToUnitBox, type Mesh } from '../core/mesh'
import {
  AXES_LENGTH,
  GRID_DIVISIONS,
  GRID_HALF_SIZE,
  GRID_HEIGHT,
  MAX_NORMAL_SEGMENTS,
  NORMAL_LENGTH,
  axesSegments,
  boundingBoxSegments,
  edgesOfMesh,
  gridSegments,
  normalSegments,
} from '../core/overlays'
import type { Vec3 } from '../core/vec3'
import { DEFAULT_VIEW_OPTIONS, drawsEdges, drawsFill, type ViewOptions } from '../core/viewOptions'
import { createIndexedMesh, type IndexedMesh } from './buffers'
import { createLineRenderer, type LineRenderer, type LineSeries } from './lineRenderer'
import { createProgram, findUniforms } from './shader'
import fragmentSource from './shaders/mesh.frag?raw'
import vertexSource from './shaders/mesh.vert?raw'

const BACKGROUND_COLOR = '#F7F4EE'
const OBJECT_COLOR = '#2E5D7C'

// Couleurs des traits, choisies pour rester lisibles sur le fond clair (#F7F4EE) ET sur l'objet
// bleu-pétrole (#2E5D7C). Pas de lumière : un trait garde sa couleur exacte. Les contrastes sont des
// ordres de grandeur calculés sur les couleurs de base, à valider à l'oeil dans un navigateur.
const LINE_COLORS = {
  // Gris très foncé (slate-800) : contraste d'environ 13 contre le fond, et assez sombre pour se
  // détacher des faces claires de l'objet éclairé. Contre le bleu-pétrole, environ 2 : les traits
  // restent visibles mais discrets sur les faces dans l'ombre.
  edges: parseHexColor('#1F2937'),
  // Ambre du portfolio : nettement différent du gris des arêtes et du bleu de l'objet, pour qu'une
  // normale ne se confonde ni avec le fil de fer ni avec la surface.
  normals: parseHexColor('#C1792E'),
  // Gris moyen (slate-500) : une aide discrète, qui entoure l'objet sans rivaliser avec lui.
  box: parseHexColor('#6B7280'),
  // Gris clair, chaud comme le fond (stone-400) : une référence de fond, pas du contenu. Elle doit se
  // voir sans prendre le dessus.
  grid: parseHexColor('#A8A29E'),
  // Rouge, vert, bleu : la convention de tous les logiciels 3D pour X, Y, Z, reconnue au premier coup d'oeil.
  axisX: parseHexColor('#DC2626'),
  axisY: parseHexColor('#16A34A'),
  axisZ: parseHexColor('#2563EB'),
}

/** Ouverture verticale de la caméra : 45 degrés, convertis en radians. */
const FIELD_OF_VIEW = (45 * Math.PI) / 180
const NEAR_PLANE = 0.1
const FAR_PLANE = 100

/** Matrice du monde : les aides du monde (grille, axes) ne tournent pas avec l'objet. */
const WORLD_MODEL = identity()

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

/**
 * Les aides en traits. Chacune est créée au PREMIER besoin (pas avant) et gardée ensuite : une aide
 * qu'on n'affiche jamais ne coûte ni calcul ni mémoire GPU.
 */
type OverlayKey = 'edges' | 'normals' | 'box' | 'grid' | 'axes'

/**
 * Les aides calculées à partir du maillage : elles dépendent de l'objet affiché, donc elles sont
 * jetées et recalculées quand le maillage change. La grille et les axes n'en dépendent pas.
 */
const OBJECT_OVERLAYS: readonly OverlayKey[] = ['edges', 'normals', 'box']

/**
 * Ce que le renderer remet quand la création d'une aide échoue : l'option qui la demande revient à son
 * état sûr (affichage plein, case décochée). Le renderer ne peut pas se permettre de laisser
 * l'erreur remonter du dessin : la boucle d'animation s'arrêterait. Un `Record` complet : TypeScript
 * protestera si une aide est ajoutée sans repli.
 */
const RESET_ON_FAILURE: Record<OverlayKey, Partial<ViewOptions>> = {
  edges: { displayMode: 'solid' },
  normals: { showNormals: false },
  box: { showBoundingBox: false },
  grid: { showGrid: false },
  axes: { showAxes: false },
}

/**
 * Appelé quand une aide n'a pas pu être créée (mémoire GPU saturée, maillage trop gros pour le fil de
 * fer, contexte perdu) : l'erreur, et la partie des options que le renderer a déjà remise à sa
 * valeur sûre (`{ displayMode: 'solid' }` pour le fil de fer). Le renderer a alors déjà basculé : à
 * l'appelant de mettre son interface en accord avec l'écran et de prévenir l'utilisateur.
 */
export type OverlayErrorHandler = (error: unknown, reset: Partial<ViewOptions>) => void

/** Une série de traits et sa couleur. */
interface ColoredSeries {
  series: LineSeries
  color: Vec3
}

export interface MeshRenderer {
  /** Adapte la zone de dessin et la projection à la taille du tampon de dessin, en pixels. */
  setViewport: (width: number, height: number) => void
  /** Dessine une image, l'objet tourné de `angleY` radians autour de l'axe vertical. */
  draw: (angleY: number) => void
  /**
   * Place la caméra. La caméra est d'abord assainie (bornée, jamais de NaN), puis la matrice de vue ET
   * la position de l'oeil (que le fragment shader utilise pour le reflet) sont recalculées ensemble,
   * à partir de la même position : elles ne peuvent pas se contredire. La matrice de vue part aussi
   * au programme des lignes. Le prochain dessin les utilise.
   */
  setCamera: (camera: OrbitCamera) => void
  /**
   * Change les options de vue (culling, mode d'affichage, aides...). Le prochain dessin les utilise ;
   * les aides sont créées à ce moment-là si elles ne le sont pas encore.
   */
  setViewOptions: (options: ViewOptions) => void
  /**
   * Remplace le maillage affiché. Le nouveau est créé AVANT de supprimer l'ancien : si sa création
   * échoue (mémoire GPU, contexte perdu), l'erreur est relancée et l'ancien reste affiché. Les aides
   * liées à l'ancien maillage (arêtes, normales, boîte) sont jetées : elles seront recalculées.
   */
  setMesh: (mesh: Mesh) => void
  /**
   * Change l'éclairage (modèle, position et couleur de la lumière, reflet...). Les réglages sont
   * d'abord assainis (bornés, jamais de NaN) puis envoyés au GPU ; le prochain dessin les utilise.
   */
  setLighting: (settings: LightingSettings) => void
  /** Supprime les deux programmes, le maillage et toutes les aides (buffers + VAO). */
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
 * par les paramètres (valeurs par défaut sinon). Les aides en traits sont recréées toutes seules au
 * premier dessin, puisque les options disent lesquelles afficher.
 *
 * `onOverlayError` est prévenu si une aide ne peut pas être créée (voir `OverlayErrorHandler`).
 */
export function createMeshRenderer(
  gl: WebGL2RenderingContext,
  initialMesh: Mesh,
  initialLighting: LightingSettings = DEFAULT_LIGHTING,
  initialCamera: OrbitCamera = DEFAULT_CAMERA,
  initialViewOptions: ViewOptions = DEFAULT_VIEW_OPTIONS,
  onOverlayError?: OverlayErrorHandler,
): MeshRenderer {
  const program = createProgram(gl, vertexSource, fragmentSource)

  // Le programme des lignes, créé tout de suite (et pas au premier trait) : si ses shaders sont
  // refusés, on le sait au démarrage et le message de repli s'affiche, au lieu d'une erreur
  // tardive pendant un dessin.
  let lines: LineRenderer
  try {
    lines = createLineRenderer(gl)
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  }

  let current: IndexedMesh
  let uniforms: ReturnType<typeof findMeshUniforms>
  try {
    uniforms = findMeshUniforms(gl, program)
    current = uploadMesh(gl, initialMesh)
  } catch (error) {
    lines.dispose()
    gl.deleteProgram(program)
    throw error
  }

  // Le maillage d'ORIGINE (non normalisé) : les aides qui en dépendent le renormalisent quand on les
  // crée. On garde la référence plutôt qu'une copie normalisée, qui doublerait la mémoire d'un gros
  // fichier (le maillage d'origine est déjà gardé par l'appelant).
  let source = initialMesh
  // Les options courantes, relues à chaque dessin. Elles peuvent changer toutes seules si la création
  // d'une aide échoue (voir `ensureOverlay`).
  let options = initialViewOptions
  const overlays = new Map<OverlayKey, ColoredSeries[]>()

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
    // La MÊME matrice de vue pour les traits : sinon ils ne tomberaient pas sur l'objet.
    lines.setView(view)
  }
  applyCamera(initialCamera)

  // --- Options de vue. Refaites à la création : un contexte restauré repart avec le culling désactivé.
  const applyViewOptions = (next: ViewOptions) => {
    options = next
    if (next.backfaceCulling) {
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
    lines.setProjection(projection) // la même projection pour les traits
  }
  // Projection de départ (aspect 1) : définie avant que la taille réelle soit connue.
  setProjection(perspective(FIELD_OF_VIEW, 1, NEAR_PLANE, FAR_PLANE))

  // --- Aides en traits.

  /** Jette les aides liées à l'ancien maillage : leurs données ne correspondent plus à ce qui est affiché. */
  const discardObjectOverlays = () => {
    for (const key of OBJECT_OVERLAYS) {
      for (const { series } of overlays.get(key) ?? []) series.dispose()
      overlays.delete(key)
    }
  }

  /**
   * Crée l'aide `key` si elle n'existe pas encore. `build` fabrique ses séries (positions et couleur).
   * Si quelque chose échoue (calcul refusé, envoi au GPU impossible), on libère ce qui avait été
   * créé, on remet l'option à son état sûr et on prévient l'appelant : l'erreur ne remonte JAMAIS
   * du dessin, qui doit continuer (l'objet plein reste affiché).
   */
  const ensureOverlay = (key: OverlayKey, build: () => { positions: Float32Array; color: Vec3 }[]) => {
    if (overlays.has(key)) return
    const created: ColoredSeries[] = []
    try {
      for (const { positions, color } of build()) {
        // Une aide vide (par exemple les arêtes d'un maillage réduit à un point) ne dessine rien.
        if (positions.length > 0) created.push({ series: lines.createSeries(positions), color })
      }
    } catch (error) {
      for (const { series } of created) series.dispose()
      // Contexte perdu pendant la création : ce n'est pas la faute de l'aide, et la restauration
      // recréera un renderer neuf avec les options courantes. On ne mémorise rien, on ne change pas
      // les options (sinon l'utilisateur perdrait son choix pour un simple incident de GPU) et on ne
      // prévient personne.
      if (gl.isContextLost()) return
      const reset = RESET_ON_FAILURE[key]
      options = { ...options, ...reset }
      // Rien ne doit sortir de `draw` (la boucle d'animation s'arrêterait) : un rappel qui lève une
      // exception est journalisé et ignoré.
      try {
        onOverlayError?.(error, reset)
      } catch (callbackError) {
        console.error("Démonstrateur 3D : le rappel d'erreur des aides a lui-même échoué.", callbackError)
      }
      return
    }
    overlays.set(key, created)
  }

  /**
   * Crée, au premier besoin, les aides que les options demandent. Les aides liées à l'objet sont
   * calculées sur le maillage NORMALISÉ (celui qui est réellement à l'écran, centré et de côté 2),
   * sinon elles ne tomberaient pas sur ce qu'on voit.
   */
  const prepareOverlays = () => {
    let unitMesh: Mesh | null = null
    const getUnitMesh = () => (unitMesh ??= normalizeToUnitBox(source))

    // Calcul PARESSEUX des arêtes : un gros fichier OBJ coûte cher (voir `edgesOfMesh`), on ne le paie
    // que si on passe vraiment en fil de fer, et une seule fois par maillage.
    if (drawsEdges(options.displayMode)) {
      ensureOverlay('edges', () => [{ positions: edgesOfMesh(getUnitMesh()), color: LINE_COLORS.edges }])
    }
    if (options.showNormals) {
      ensureOverlay('normals', () => [
        { positions: normalSegments(getUnitMesh(), NORMAL_LENGTH, MAX_NORMAL_SEGMENTS), color: LINE_COLORS.normals },
      ])
    }
    if (options.showBoundingBox) {
      ensureOverlay('box', () => [{ positions: boundingBoxSegments(getUnitMesh()), color: LINE_COLORS.box }])
    }
    if (options.showGrid) {
      ensureOverlay('grid', () => [
        { positions: gridSegments(GRID_HALF_SIZE, GRID_DIVISIONS, GRID_HEIGHT), color: LINE_COLORS.grid },
      ])
    }
    if (options.showAxes) {
      // Trois séries (une par axe) car chaque axe a sa couleur et que le programme des lignes n'a
      // qu'une couleur par dessin.
      ensureOverlay('axes', () => {
        const axes = axesSegments(AXES_LENGTH)
        return [
          { positions: axes.slice(0, 6), color: LINE_COLORS.axisX },
          { positions: axes.slice(6, 12), color: LINE_COLORS.axisY },
          { positions: axes.slice(12, 18), color: LINE_COLORS.axisZ },
        ]
      })
    }
  }

  const drawOverlay = (key: OverlayKey, model: Mat4) => {
    for (const { series, color } of overlays.get(key) ?? []) series.draw(model, color)
  }

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

      // Avant le moindre dessin : une aide qui échoue change les options (repli sur le plein), et la
      // suite de cette image doit déjà en tenir compte.
      prepareOverlays()

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT) // efface l'image précédente et les profondeurs

      // 1. Les surfaces, sauf en fil de fer seul.
      if (drawsFill(options.displayMode)) {
        gl.useProgram(program)
        gl.uniformMatrix4fv(uniforms.uModel, false, model)
        gl.uniformMatrix3fv(uniforms.uNormalMatrix, false, normalMatrix(model))
        const withEdges = drawsEdges(options.displayMode)
        if (withEdges) {
          // POLYGON OFFSET. Les arêtes sont SUR les surfaces : à la même profondeur, le test de
          // profondeur hésiterait pixel par pixel entre le trait et la surface (z-fighting) et le trait
          // serait mangé par endroits. L'offset décale légèrement les surfaces vers l'arrière :
          // chaque pixel est repoussé de `facteur x pente de la surface + unités x plus petit écart de
          // profondeur mesurable`. (1, 1) est le réglage classique : assez pour gagner à coup sûr, trop
          // peu pour voir une différence de forme. Il ne concerne que les surfaces (POLYGON_OFFSET_FILL),
          // jamais les traits : ceux-ci gardent leur vraie profondeur et passent devant.
          gl.enable(gl.POLYGON_OFFSET_FILL)
          gl.polygonOffset(1, 1)
        }
        current.draw()
        if (withEdges) gl.disable(gl.POLYGON_OFFSET_FILL) // seulement pour ce dessin
      }

      // 2. Les aides liées à l'objet : la MÊME matrice de modèle que lui (elles tournent avec lui).
      if (drawsEdges(options.displayMode)) drawOverlay('edges', model)
      if (options.showNormals) drawOverlay('normals', model)
      if (options.showBoundingBox) drawOverlay('box', model)

      // 3. Les aides du monde : matrice identité, elles ne tournent pas avec l'objet.
      if (options.showGrid) drawOverlay('grid', WORLD_MODEL)
      if (options.showAxes) drawOverlay('axes', WORLD_MODEL)
    },

    setMesh(mesh) {
      // Le nouveau maillage est créé d'abord : s'il échoue (fabrique `null` ou erreur lue par
      // `getError`, comme OUT_OF_MEMORY, voir createIndexedMesh), rien n'a été touché : ni `current`,
      // ni `source`, ni les aides.
      const next = uploadMesh(gl, mesh)
      current.dispose() // libère l'ancien VAO et ses buffers, que le ramasse-miettes ne verrait pas
      current = next
      source = mesh
      // Arêtes, normales et boîte de l'ancien maillage ne correspondent plus à rien : elles seront
      // recalculées, au prochain dessin, pour le nouveau.
      discardObjectOverlays()
    },

    setLighting: applyLighting,

    setCamera: applyCamera,

    setViewOptions: applyViewOptions,

    dispose() {
      current.dispose()
      overlays.clear() // les séries elles-mêmes sont libérées par `lines.dispose()`
      lines.dispose()
      // Supprime aussi les shaders encore attachés (voir createProgram).
      gl.deleteProgram(program)
    },
  }
}

/** Retrouve les uniforms du programme de l'objet (voir `findUniforms`). */
function findMeshUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  return findUniforms(gl, program, UNIFORM_NAMES)
}
