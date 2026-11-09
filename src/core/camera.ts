/**
 * Caméra orbitale, sans React ni WebGL.
 *
 * Une caméra orbitale tourne autour d'un point (ici l'origine, où `normalizeToUnitBox` a centré
 * l'objet) en restant toujours tournée vers lui. Elle se décrit avec trois nombres, des
 * coordonnées SPHÉRIQUES, plus faciles à modifier à la souris que trois coordonnées cartésiennes :
 * - l'azimut : l'angle autour de l'axe vertical (glisser vers la droite ou la gauche) ;
 * - l'élévation : l'angle au-dessus ou au-dessous de l'objet (glisser vers le haut ou le bas) ;
 * - la distance à l'origine (la molette).
 * `cameraPosition` les convertit en coordonnées cartésiennes pour construire la matrice de vue.
 *
 * Toutes les fonctions renvoient une NOUVELLE caméra et bornent le résultat : une caméra qui sort des
 * plages ou qui contient un NaN ne peut pas exister après un appel.
 */

import type { Vec3 } from './vec3'

export interface OrbitCamera {
  /**
   * Angle autour de l'axe vertical, en radians, dans [-PI, PI]. 0 : la caméra est sur l'axe +Z
   * (c'est la position de départ). Un azimut positif la déplace vers +X (vers la droite de l'écran).
   */
  azimuth: number
  /** Angle au-dessus du plan horizontal, en radians. 0 : à hauteur de l'objet ; positif : au-dessus. */
  elevation: number
  /** Distance entre la caméra et l'origine, en unités du monde (l'objet tient dans un cube de côté 2). */
  distance: number
}

/** Plage d'un réglage de la caméra : bornes incluses. */
export interface CameraRange {
  min: number
  max: number
}

/**
 * Élévation bornée à environ +-86 degrés (1,5 rad) au lieu de +-90 (PI/2, soit 1,5708).
 * Aux pôles, la caméra serait pile au-dessus ou au-dessous de l'objet : la direction du regard
 * serait parallèle à « haut » (0, 1, 0), `lookAt` ne saurait plus où est la droite et lèverait une
 * erreur. À 1,5 rad il reste 0,07 rad (4 degrés) de marge, très loin du seuil de `lookAt`. Dépasser
 * le pôle retournerait aussi l'image la tête en bas, ce qui désoriente.
 */
export const ELEVATION_RANGE: CameraRange = { min: -1.5, max: 1.5 }

/**
 * Distance de 2,5 à 12. L'objet normalisé tient dans une sphère de rayon racine de 3 (environ 1,73,
 * la demi-diagonale du cube de côté 2) : à 2,5 la caméra reste donc toujours à l'extérieur de
 * l'objet, et loin du plan proche (0,1) du renderer. À 12 l'objet occupe encore environ 20 % de la
 * hauteur de l'image : plus loin, il serait trop petit pour être utile. Ces deux bornes sont des
 * choix d'ergonomie, pas des valeurs imposées par la théorie.
 */
export const DISTANCE_RANGE: CameraRange = { min: 2.5, max: 12 }

/**
 * Point regardé et direction « haut » de la caméra. `cameraPosition` suppose que la cible est
 * l'origine : ces deux constantes sont donc ici, avec la formule, et partagées avec le renderer.
 */
export const CAMERA_TARGET: Vec3 = [0, 0, 0]
export const CAMERA_UP: Vec3 = [0, 1, 0]

/**
 * Position de départ : sur l'axe +Z à 5 unités, légèrement au-dessus. L'élévation de 0,4 rad est
 * l'inclinaison fixe qu'avait l'objet avant l'arrivée de la caméra orbitale : vu pile de face, un
 * cube ressemble à un carré plat, et un plan horizontal à un simple trait.
 */
export const DEFAULT_CAMERA: OrbitCamera = { azimuth: 0, elevation: 0.4, distance: 5 }

const FULL_TURN = 2 * Math.PI

/** Renvoie `value` si c'est un nombre fini, sinon `fallback` (NaN, Infinity, texte, `undefined`). */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, range: CameraRange): number {
  return Math.min(Math.max(value, range.min), range.max)
}

/**
 * Ramène un angle dans [-PI, PI] : sans cela, tourner longtemps dans le même sens ferait grandir
 * l'azimut sans fin (et perdre de la précision). Un angle déjà dans l'intervalle est rendu tel quel,
 * sans calcul, pour ne pas y ajouter d'erreur d'arrondi. L'opérateur `%` de JavaScript est exact,
 * même pour de très grands nombres.
 */
function wrapAngle(angle: number): number {
  if (angle >= -Math.PI && angle <= Math.PI) return angle
  return ((((angle + Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN) - Math.PI
}

/**
 * Rend une caméra sûre : azimut ramené dans [-PI, PI], élévation et distance bornées, et tout
 * nombre invalide (NaN, Infinity) remplacé par la valeur de `DEFAULT_CAMERA` plutôt que collé à une
 * extrémité (même choix que `sanitizeLighting`). Le renderer l'appelle avant tout envoi au GPU.
 */
export function sanitizeCamera(camera: OrbitCamera): OrbitCamera {
  return {
    azimuth: wrapAngle(finiteOr(camera.azimuth, DEFAULT_CAMERA.azimuth)),
    elevation: clamp(finiteOr(camera.elevation, DEFAULT_CAMERA.elevation), ELEVATION_RANGE),
    distance: clamp(finiteOr(camera.distance, DEFAULT_CAMERA.distance), DISTANCE_RANGE),
  }
}

/**
 * Fait tourner la caméra autour de l'objet. Les deux écarts sont en radians (positifs : vers +X pour
 * l'azimut, vers le haut pour l'élévation). Un écart qui n'est pas un nombre fini est ignoré (0).
 */
export function orbitCamera(camera: OrbitCamera, deltaAzimuth: number, deltaElevation: number): OrbitCamera {
  return sanitizeCamera({
    azimuth: camera.azimuth + finiteOr(deltaAzimuth, 0),
    elevation: camera.elevation + finiteOr(deltaElevation, 0),
    distance: camera.distance,
  })
}

/**
 * Rapproche ou éloigne la caméra : la distance est MULTIPLIÉE par `factor` (plus petit que 1 : on se
 * rapproche). Multiplier est plus naturel qu'additionner : chaque cran de molette change la taille
 * apparente de l'objet d'une même proportion, que l'on soit près ou loin. Un facteur invalide
 * (NaN, Infinity, zéro ou négatif) est ignoré : la distance ne change pas.
 */
export function zoomCamera(camera: OrbitCamera, factor: number): OrbitCamera {
  const safeFactor = typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : 1
  return sanitizeCamera({ ...camera, distance: camera.distance * safeFactor })
}

/**
 * Position de la caméra dans le monde : conversion des coordonnées sphériques (azimut, élévation,
 * distance) en coordonnées cartésiennes, la cible étant l'origine.
 *
 * `horizontal` est la part de la distance qui reste dans le plan horizontal : elle rétrécit quand la
 * caméra monte (à l'élévation 0 c'est toute la distance, au pôle ce serait 0). Dans ce plan, l'azimut
 * 0 donne l'axe +Z et un azimut positif va vers +X.
 *
 * Cette fonction ne borne rien : le renderer passe d'abord la caméra par `sanitizeCamera`.
 */
export function cameraPosition(camera: OrbitCamera): Vec3 {
  const horizontal = camera.distance * Math.cos(camera.elevation)
  return [
    horizontal * Math.sin(camera.azimuth),
    camera.distance * Math.sin(camera.elevation),
    horizontal * Math.cos(camera.azimuth),
  ]
}
