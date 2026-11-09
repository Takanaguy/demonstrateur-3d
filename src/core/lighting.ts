/**
 * Réglages de l'éclairage et formules du reflet, sans React ni WebGL.
 *
 * Ce fichier a deux rôles :
 * 1. Dire QUELS réglages existent, leurs plages et leurs valeurs par défaut (utilisés par le panneau
 *    et par le renderer).
 * 2. Donner, en TypeScript, les deux formules de reflet que le fragment shader calcule en GLSL. Les
 *    shaders ne sont jamais exécutés par les tests (jsdom n'a pas de GPU) : ces fonctions sont la
 *    RÉFÉRENCE testable. Elles reproduisent exactement `mesh.frag`. Si l'une change, l'autre doit
 *    changer avec elle.
 */

import type { Vec3 } from './vec3'

/**
 * Les trois modèles d'éclairage.
 * - `lambert` : diffus seul, aucun reflet.
 * - `blinn-phong` : diffus + reflet en `cos(angle)^brillance`.
 * - `gaussian` : diffus + reflet en courbe de Gauss de l'angle.
 */
export type LightingModel = 'lambert' | 'blinn-phong' | 'gaussian'

export const LIGHTING_MODELS: readonly LightingModel[] = ['lambert', 'blinn-phong', 'gaussian']

export interface LightingSettings {
  model: LightingModel
  /** Position de la lumière dans le monde (une lumière ponctuelle, pas une direction). */
  position: Vec3
  /** Couleur de la lumière, au format « #RRGGBB ». */
  color: string
  /** Part de lumière que reçoit même une face tournée à l'opposé de la lumière (0 à 1). */
  ambient: number
  /** Intensité du reflet (0 à 1). Sans effet avec le modèle Lambert. */
  specular: number
  /** Brillance de Blinn-Phong : plus elle est grande, plus le reflet est petit et net. */
  shininess: number
  /** Gaussien : angle (en radians) entre la normale et le vecteur de demi-angle où le reflet est maximal. */
  gaussianMean: number
  /** Gaussien : largeur du reflet, en radians. Plus elle est petite, plus le reflet est fin. */
  gaussianStdDev: number
}

/** Plage d'un réglage numérique : bornes incluses et pas du curseur. */
export interface LightingRange {
  min: number
  max: number
  step: number
}

/** Chaque coordonnée de la position de la lumière. L'objet tient dans un cube de côté 2 : 10 est loin. */
export const POSITION_RANGE: LightingRange = { min: -10, max: 10, step: 0.5 }
export const AMBIENT_RANGE: LightingRange = { min: 0, max: 1, step: 0.01 }
export const SPECULAR_RANGE: LightingRange = { min: 0, max: 1, step: 0.01 }
export const SHININESS_RANGE: LightingRange = { min: 1, max: 256, step: 1 }
/** 0,5 rad fait environ 29 degrés : au-delà, le reflet ne serait plus centré sur le point brillant. */
export const GAUSSIAN_MEAN_RANGE: LightingRange = { min: 0, max: 0.5, step: 0.01 }
/** Minimum non nul : un écart type de 0 ferait une division par zéro dans la formule. */
export const GAUSSIAN_STD_DEV_RANGE: LightingRange = { min: 0.02, max: 1, step: 0.01 }

/**
 * Réglages de départ. Lambert, lumière blanche en (3, 4, 5) et ambiant 0,35 : avec le modèle Lambert
 * on retrouve l'éclairage diffus d'avant (la lumière est seulement devenue ponctuelle).
 */
export const DEFAULT_LIGHTING: LightingSettings = {
  model: 'lambert',
  position: [3, 4, 5],
  color: '#FFFFFF',
  ambient: 0.35,
  specular: 0.6,
  shininess: 32,
  gaussianMean: 0,
  gaussianStdDev: 0.15,
}

/**
 * Ramène `value` dans [min, max]. Tout ce qui n'est pas un nombre fini (NaN, Infinity, texte,
 * `undefined`) est remplacé par `fallback` : borner Infinity à `max` serait aussi possible, mais une
 * valeur qui n'a aucun sens vaut mieux ramenée au réglage par défaut qu'à une extrémité.
 */
function clampNumber(value: unknown, range: LightingRange, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, range.min), range.max)
}

/**
 * Rend des réglages sûrs à envoyer au GPU : chaque nombre est borné à sa plage, un nombre invalide
 * redevient la valeur par défaut, et un modèle ou une couleur invalide aussi.
 *
 * Elle est appelée par le renderer avant tout envoi : un NaN dans un uniform donnerait des pixels
 * noirs ou blancs imprévisibles dans tout l'objet, sans erreur nulle part. Les types de TypeScript
 * ne protègent pas ici (les valeurs peuvent venir d'un curseur mal lu, d'un futur fichier de
 * réglages...), d'où les vérifications à l'exécution.
 */
export function sanitizeLighting(settings: LightingSettings): LightingSettings {
  const position = settings.position as readonly unknown[] | undefined
  const defaults = DEFAULT_LIGHTING
  return {
    model: LIGHTING_MODELS.includes(settings.model) ? settings.model : defaults.model,
    position: [
      clampNumber(position?.[0], POSITION_RANGE, defaults.position[0]),
      clampNumber(position?.[1], POSITION_RANGE, defaults.position[1]),
      clampNumber(position?.[2], POSITION_RANGE, defaults.position[2]),
    ],
    color: typeof settings.color === 'string' && /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : defaults.color,
    ambient: clampNumber(settings.ambient, AMBIENT_RANGE, defaults.ambient),
    specular: clampNumber(settings.specular, SPECULAR_RANGE, defaults.specular),
    shininess: clampNumber(settings.shininess, SHININESS_RANGE, defaults.shininess),
    gaussianMean: clampNumber(settings.gaussianMean, GAUSSIAN_MEAN_RANGE, defaults.gaussianMean),
    gaussianStdDev: clampNumber(settings.gaussianStdDev, GAUSSIAN_STD_DEV_RANGE, defaults.gaussianStdDev),
  }
}

/**
 * Reflet de Blinn-Phong : `max(N·H, 0) ^ brillance`.
 *
 * `nDotH` est le produit scalaire entre la normale N et le vecteur de demi-angle H (le milieu entre
 * la direction vers la lumière et la direction vers l'oeil). Il vaut 1 quand la normale pointe pile
 * entre la lumière et l'oeil (le point le plus brillant) et diminue quand on s'en écarte. La
 * puissance resserre le reflet : plus la brillance est grande, plus il tombe vite vers 0.
 *
 * Reproduit exactement la formule de `mesh.frag` (référence testable, voir l'en-tête du fichier).
 */
export function blinnPhongSpecular(nDotH: number, shininess: number): number {
  return Math.pow(Math.max(nDotH, 0), shininess)
}

/**
 * Reflet gaussien : `exp(-(theta - moyenne)^2 / (2 * ecartType^2))`, avec `theta = acos(N·H)`.
 *
 * `theta` est l'angle (en radians) entre la normale et le vecteur de demi-angle. Le reflet est une
 * courbe en cloche de cet angle : maximal (1) quand `theta` vaut la moyenne, et à `exp(-0.5)`
 * (environ 0,61) un écart type plus loin. Avec une moyenne nulle, le maximum est au centre du reflet ;
 * avec une moyenne non nulle, c'est un anneau qui est le plus brillant (voir « Limites connues »).
 *
 * `nDotH` est borné à [-1, 1] avant `acos` : de petites erreurs d'arrondi peuvent le pousser à
 * 1,0000001, et `acos` renverrait alors NaN.
 *
 * Reproduit exactement la formule de `mesh.frag` (référence testable, voir l'en-tête du fichier).
 */
export function gaussianSpecular(nDotH: number, mean: number, stdDev: number): number {
  const theta = Math.acos(Math.min(Math.max(nDotH, -1), 1))
  const offset = theta - mean
  return Math.exp(-(offset * offset) / (2 * stdDev * stdDev))
}
