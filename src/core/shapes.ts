/**
 * Générateurs de formes de base (plan, sphère, cône) et choix d'une forme par son nom. Sans React
 * ni WebGL. Le cube est dans `cube.ts`.
 *
 * Règles communes à toutes les formes :
 * - les normales sont unitaires (longueur 1) ;
 * - chaque triangle est ordonné dans le sens inverse des aiguilles d'une montre vu de l'EXTÉRIEUR
 *   (c'est ce sens qui permet de savoir de quel côté est la face avant) ;
 * - un sommet qui doit avoir deux normales différentes (une arête vive, comme le bord de la base
 *   d'un cône) est DUPLIQUÉ : un sommet GPU ne porte qu'une seule normale.
 */

import { createCubeGeometry } from './cube'
import { createIndexArray, type Mesh } from './mesh'

/** Bornes des paramètres de la sphère et du cône : assez fines pour être rondes, assez petites pour rester légères. */
export const MIN_SEGMENTS = 3
export const MAX_SEGMENTS = 256
export const MIN_RINGS = 2
export const MAX_RINGS = 256

function checkIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} invalide : ${value} (attendu : un entier entre ${min} et ${max}).`)
  }
}

/**
 * Carré de côté `size` dans le plan XZ (horizontal), centré sur l'origine, normale +Y.
 * Quatre sommets, deux triangles.
 */
export function createPlane(size = 2): Mesh {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`Taille de plan invalide : ${size} (attendu : un nombre strictement positif).`)
  }
  const h = size / 2
  // Vu de dessus (depuis +Y), l'ordre (-h,-h) -> (-h,+h) -> (+h,+h) -> (+h,-h) tourne dans le
  // sens inverse des aiguilles d'une montre : la face visible est celle du dessus.
  const positions = new Float32Array([-h, 0, -h, -h, 0, h, h, 0, h, h, 0, -h])
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3])
  return { positions, normals, indices }
}

/**
 * Sphère « UV » de rayon 1 : on la découpe comme un globe terrestre, en `rings` bandes de
 * latitude et `segments` tranches de longitude.
 *
 * Sommets : (segments + 1) x (rings + 1). Le « + 1 » vient de la couture : la première et la
 * dernière tranche ont la même position, mais restent des sommets distincts pour que le
 * découpage soit régulier (et prêt pour d'éventuelles textures). Aux deux pôles, tous les sommets
 * d'une même rangée sont au même point.
 *
 * Normales lisses : pour une sphère centrée à l'origine, la normale en un point est simplement la
 * direction de ce point par rapport au centre, soit sa position (de longueur 1 puisque le rayon
 * vaut 1). Aucun calcul de triangle n'est nécessaire.
 *
 * Triangles : chaque case (bande, tranche) donne deux triangles, sauf aux pôles où l'un des deux
 * serait d'aire nulle (deux de ses sommets sont au même point) : on l'omet. Cela donne
 * 2 x segments x (rings - 1) triangles.
 */
export function createSphere(segments: number, rings: number): Mesh {
  checkIntegerInRange('Nombre de segments', segments, MIN_SEGMENTS, MAX_SEGMENTS)
  checkIntegerInRange('Nombre d\'anneaux', rings, MIN_RINGS, MAX_RINGS)

  const columns = segments + 1
  const vertexTotal = columns * (rings + 1)
  const positions = new Float32Array(vertexTotal * 3)
  const normals = new Float32Array(vertexTotal * 3)

  for (let ring = 0; ring <= rings; ring++) {
    // Angle depuis le pôle nord (+Y) : 0 en haut, pi en bas.
    const polar = (Math.PI * ring) / rings
    for (let segment = 0; segment <= segments; segment++) {
      const azimuth = (2 * Math.PI * segment) / segments // angle autour de l'axe Y
      const vertex = (ring * columns + segment) * 3
      const x = Math.sin(polar) * Math.cos(azimuth)
      const y = Math.cos(polar)
      const z = Math.sin(polar) * Math.sin(azimuth)
      positions.set([x, y, z], vertex)
      normals.set([x, y, z], vertex)
    }
  }

  const indices = createIndexArray(2 * segments * (rings - 1) * 3, vertexTotal)
  let cursor = 0
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      // Les quatre coins de la case : a (haut), c (haut, tranche suivante), b (bas), d (bas, tranche suivante).
      const a = ring * columns + segment
      const c = a + 1
      const b = a + columns
      const d = b + 1
      // Vue de l'extérieur, la tranche suivante est à gauche : (a, c, b) puis (c, d, b) tournent
      // dans le sens inverse des aiguilles d'une montre.
      if (ring !== 0) {
        indices.set([a, c, b], cursor) // omis en haut : a et c y sont confondus
        cursor += 3
      }
      if (ring !== rings - 1) {
        indices.set([c, d, b], cursor) // omis en bas : b et d y sont confondus
        cursor += 3
      }
    }
  }
  return { positions, normals, indices }
}

/**
 * Cône de rayon 1 et de hauteur 2 : base ronde en y = -1 (normale -Y), pointe en y = +1.
 *
 * Trois groupes de sommets, car une normale par sommet ne suffit pas à décrire un cône :
 * - la couronne du flanc (segments + 1 sommets, couture comprise) : sur le flanc, la normale est
 *   (h cos a, r, h sin a) normalisée, avec h = 2 la hauteur, r = 1 le rayon et a l'angle autour de
 *   Y. Elle penche vers le haut (composante r) d'autant plus que le cône est large ;
 * - les sommets de la pointe : UN PAR TRANCHE (segments sommets), tous à la même position mais
 *   chacun avec la normale du milieu de sa tranche. Avec un seul sommet de pointe, il faudrait
 *   choisir une normale parmi toutes celles de la pointe, où elle n'est pas définie : l'éclairage
 *   serait faux sur tout le flanc ;
 * - la base : un centre et une couronne SÉPARÉS de celle du flanc (segments + 1 sommets), car
 *   le bord de la base est une arête vive (normale -Y en bas, normale du flanc en haut).
 *
 * Sommets : 3 x segments + 2. Triangles : 2 x segments (un par tranche pour le flanc, un par
 * tranche pour la base).
 */
export function createCone(segments: number): Mesh {
  checkIntegerInRange('Nombre de segments', segments, MIN_SEGMENTS, MAX_SEGMENTS)

  const height = 2
  const radius = 1
  const baseY = -1
  const apexY = 1
  const slantLength = Math.hypot(height, radius)

  const sideRing = segments + 1
  const apexStart = sideRing
  const baseCenter = apexStart + segments
  const baseRingStart = baseCenter + 1
  const vertexTotal = baseRingStart + segments
  const positions = new Float32Array(vertexTotal * 3)
  const normals = new Float32Array(vertexTotal * 3)

  /** Normale du flanc dans la direction `angle` autour de Y, de longueur 1. */
  const sideNormal = (angle: number): [number, number, number] => [
    (height * Math.cos(angle)) / slantLength,
    radius / slantLength,
    (height * Math.sin(angle)) / slantLength,
  ]

  for (let s = 0; s <= segments; s++) {
    const angle = (2 * Math.PI * s) / segments
    positions.set([radius * Math.cos(angle), baseY, radius * Math.sin(angle)], s * 3)
    normals.set(sideNormal(angle), s * 3)
  }
  for (let s = 0; s < segments; s++) {
    // Normale du milieu de la tranche s (entre les angles s et s + 1).
    const middle = (2 * Math.PI * (s + 0.5)) / segments
    positions.set([0, apexY, 0], (apexStart + s) * 3)
    normals.set(sideNormal(middle), (apexStart + s) * 3)
  }
  positions.set([0, baseY, 0], baseCenter * 3)
  normals.set([0, -1, 0], baseCenter * 3)
  for (let s = 0; s < segments; s++) {
    const angle = (2 * Math.PI * s) / segments
    positions.set([radius * Math.cos(angle), baseY, radius * Math.sin(angle)], (baseRingStart + s) * 3)
    normals.set([0, -1, 0], (baseRingStart + s) * 3)
  }

  const indices = createIndexArray(segments * 2 * 3, vertexTotal)
  for (let s = 0; s < segments; s++) {
    // Flanc, vu de l'extérieur : la tranche suivante est à gauche. Bas-droite -> pointe -> bas-gauche
    // tourne dans le sens inverse des aiguilles d'une montre.
    indices.set([s, apexStart + s, s + 1], s * 3)
    // Base, vue d'en dessous (de l'extérieur) : centre -> couronne s -> couronne s + 1, le dernier
    // retombant sur le premier pour refermer le disque.
    indices.set([baseCenter, baseRingStart + s, baseRingStart + ((s + 1) % segments)], (segments + s) * 3)
  }
  return { positions, normals, indices }
}

/** Les formes proposées dans l'interface, dans l'ordre d'affichage. */
export const SHAPE_IDS = ['cube', 'sphere', 'plane', 'cone'] as const
export type ShapeId = (typeof SHAPE_IDS)[number]

/**
 * Fabrique la forme demandée avec les réglages d'affichage par défaut. La sphère et le cône ont
 * assez de facettes pour paraître ronds sans peser sur le GPU (un peu plus de 1 000 sommets).
 */
export function createShape(id: ShapeId): Mesh {
  switch (id) {
    case 'cube':
      return createCubeGeometry(2)
    case 'sphere':
      return createSphere(48, 24)
    case 'plane':
      return createPlane(2)
    case 'cone':
      return createCone(48)
  }
}
