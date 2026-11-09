/**
 * Les « aides » dessinées en traits : arêtes du maillage (fil de fer), normales, boîte englobante,
 * grille et axes. Sans React ni WebGL : chaque fonction fabrique seulement des POSITIONS, que le
 * renderer enverra au GPU, ce qui permet de tout tester avec de simples nombres.
 *
 * Format commun : un `Float32Array` de PAIRES de points. Chaque segment occupe 6 flottants
 * (x1, y1, z1, x2, y2, z2), donc `positions.length / 6` segments. C'est ce que `gl.LINES` attend :
 * il relie le premier point au deuxième, le troisième au quatrième, etc.
 *
 * Les aides liées à l'objet (arêtes, normales, boîte) doivent être calculées sur le maillage déjà
 * NORMALISÉ (`normalizeToUnitBox`, centré et de côté 2), celui qui est réellement affiché, et
 * dessinées avec la même matrice de modèle que lui. La grille et les axes, eux, sont dans le monde :
 * ils ne tournent pas avec l'objet.
 */

import { boundingBox, triangleCount, vertexCount, type Mesh } from './mesh'

/** Nombre de flottants d'un segment : deux points de trois coordonnées. */
const FLOATS_PER_SEGMENT = 6

/** Nombre de segments d'une série de positions. */
export function segmentCount(positions: Float32Array): number {
  return positions.length / FLOATS_PER_SEGMENT
}

// --- Aides du monde : leurs dimensions sont des choix de lisibilité, calés sur l'objet affiché, qui tient
// toujours dans un cube de côté 2 (de -1 à +1).

/**
 * Demi-côté de la grille : 3, soit plus que le point le plus éloigné de l'objet (un coin du cube, à
 * environ 1,73 du centre). La grille déborde donc de l'objet de tous les côtés, comme un sol.
 */
export const GRID_HALF_SIZE = 3
/**
 * Nombre de cases par côté : 12. Une case mesure donc 0,5 (6 / 12), soit un quart du côté de l'objet :
 * la grille sert de règle. Un nombre pair place une ligne exactement sur les axes X et Z.
 */
export const GRID_DIVISIONS = 12
/**
 * Hauteur de la grille : -1,2. Le point le plus bas de l'objet est à -1 : l'écart de 0,2 évite que la
 * grille touche l'objet (un cône pose sa base à -1) et qu'elle se confonde avec lui.
 */
export const GRID_HEIGHT = -1.2
/**
 * Longueur des axes : 2, le côté de la boîte unité. Ils partent de l'origine (le centre de l'objet) :
 * la moitié de chacun, dans l'objet, est cachée par lui, il dépasse d'au moins 1 de la surface.
 */
export const AXES_LENGTH = 2

// --- Aides liées à l'objet.

/**
 * Longueur d'un segment de normale : 0,15, soit 7,5 % du côté de l'objet. À peu près l'écart entre
 * deux sommets de la sphère (2 PI / 48 = 0,13) : assez long pour se voir, assez court pour ne pas
 * noyer l'objet sous les traits.
 */
export const NORMAL_LENGTH = 0.15

/**
 * Nombre maximal de normales dessinées : 4 000. Au-delà, on n'en dessine qu'une sur k (voir
 * `normalSegments`). Un gros fichier OBJ a des centaines de milliers de sommets : toutes les normales
 * formeraient une masse illisible et coûteraient inutilement cher. La sphère proposée (1 225
 * sommets) et le cône (146) restent complets. Valeur de confort, pas une mesure.
 */
export const MAX_NORMAL_SEGMENTS = 4000

/**
 * Nombre maximal de triangles pour lequel on calcule le fil de fer : 500 000 (la moitié de la limite
 * de l'analyseur OBJ). Le calcul est fait sur le fil principal de la page, et il retient en mémoire
 * un tableau de sommets, une table de positions et un ensemble d'arêtes (de l'ordre de 1,5 arête par
 * triangle) : au-delà, l'onglet risquerait de se figer ou de manquer de mémoire. Au-delà, le fil de
 * fer est refusé avec un message clair plutôt qu'à moitié calculé. Valeur de prudence, mesurée
 * seulement sous Node (voir la décision 19), pas dans un navigateur.
 */
export const MAX_EDGE_TRIANGLES = 500_000

/**
 * Finesse de la grille qui sert à reconnaître deux sommets « à la même position » : la plus grande
 * dimension du maillage est découpée en 100 000 pas. Deux positions qui diffèrent de moins d'un
 * pas (soit 0,00002 pour un objet de côté 2) sont la même.
 *
 * POURQUOI NE PAS COMPARER EXACTEMENT. Les formes générées par le code utilisent des cosinus et des
 * sinus : le sommet à 2 PI de la couture d'une sphère vaut z = -2e-16 au lieu de 0, et le pôle sud
 * (sin PI = 1,2e-16) n'est pas exactement un point. Une comparaison exacte verrait des centaines de
 * « sommets différents » là où il n'y en a qu'un, et dessinerait des arêtes de longueur nulle en plus.
 */
const POSITION_GRID = 100_000
/**
 * Nombre de valeurs possibles d'une coordonnée après arrondi (0 à 100 000 inclus). Trois coordonnées
 * se combinent en UN nombre `(x * N + y) * N + z`, qui reste un entier exact en JavaScript (moins de
 * 2^53) : une `Map` de nombres est bien plus rapide et légère qu'une `Map` de textes.
 */
const CELLS_PER_AXIS = POSITION_GRID + 1

/**
 * Les arêtes UNIQUES des triangles, en paires de positions.
 *
 * C'est un fil de fer de MAILLAGE : on veut voir les triangles, donc les diagonales des faces carrées
 * sont dessinées aussi. Un cube donne 18 segments (ses 12 arêtes et les 6 diagonales issues de la
 * triangulation de ses 6 faces), pas 12.
 *
 * UNICITÉ SUR LA POSITION, pas sur l'indice de sommet. Le cube a 24 sommets (chaque coin existe en
 * trois exemplaires, un par face, pour avoir des normales nettes, voir `cube.ts`) : comparer les
 * indices dessinerait chaque arête du cube deux fois (une par face voisine) et resterait faux pour
 * toute forme dont les sommets sont dupliqués. En comparant les positions, deux triangles qui
 * partagent une arête, ou deux sommets doublés au même endroit, ne donnent qu'UN segment.
 *
 * Les arêtes de longueur nulle (deux sommets du triangle à la même position, comme un triangle
 * aplati) ne sont pas dessinées.
 *
 * COÛT. Une passe sur les sommets (une `Map` de positions) puis une sur les triangles (un `Set` de
 * paires). Mémoire et temps croissent avec le nombre de triangles : au-delà de `maxTriangles`, une
 * `RangeError` en français est levée, que le renderer transforme en repli sur l'affichage plein.
 */
export function edgesOfMesh(mesh: Mesh, maxTriangles = MAX_EDGE_TRIANGLES): Float32Array {
  const triangles = triangleCount(mesh)
  if (triangles > maxTriangles) {
    throw new RangeError(
      `Fil de fer indisponible : ce maillage a ${triangles} triangles, le maximum est ${maxTriangles}.`,
    )
  }
  const box = boundingBox(mesh)
  if (!box || triangles === 0) return new Float32Array(0)

  const { positions, indices } = mesh
  const total = vertexCount(mesh)

  // Taille d'un pas de la grille d'arrondi. Un maillage réduit à un point (grand côté nul) n'a qu'une
  // position : n'importe quel pas convient, 1 évite de diviser par zéro.
  const largestSide = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2])
  const cellSize = largestSide > 0 ? largestSide / POSITION_GRID : 1
  const cell = (axis: number, value: number) => Math.round((value - box.min[axis]!) / cellSize)

  // `representative[v]` : le premier sommet qui a la même position que le sommet v (lui-même s'il est
  // le premier). Deux sommets de même position ont le même représentant.
  const representative = new Int32Array(total)
  const firstWithCell = new Map<number, number>()
  for (let v = 0; v < total; v++) {
    const key =
      (cell(0, positions[v * 3]!) * CELLS_PER_AXIS + cell(1, positions[v * 3 + 1]!)) * CELLS_PER_AXIS +
      cell(2, positions[v * 3 + 2]!)
    const first = firstWithCell.get(key)
    if (first === undefined) {
      firstWithCell.set(key, v)
      representative[v] = v
    } else {
      representative[v] = first
    }
  }

  // Une arête est la paire de ses deux représentants, le plus petit en premier : (a, b) et (b, a) sont
  // la même arête. La paire devient un seul nombre `petit * total + grand`, exact et sans doublon.
  const edgeKeys = new Set<number>()
  const addEdge = (from: number, to: number) => {
    const a = representative[from]!
    const b = representative[to]!
    if (a === b) return // arête de longueur nulle
    edgeKeys.add(a < b ? a * total + b : b * total + a)
  }
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t]!
    const i1 = indices[t + 1]!
    const i2 = indices[t + 2]!
    if (i0 >= total || i1 >= total || i2 >= total) {
      throw new RangeError(`Indice hors limites : il n'y a que ${total} sommets.`)
    }
    addEdge(i0, i1)
    addEdge(i1, i2)
    addEdge(i2, i0)
  }

  // Les deux extrémités sont retrouvées en défaisant la division : key = petit * total + grand.
  const result = new Float32Array(edgeKeys.size * FLOATS_PER_SEGMENT)
  let cursor = 0
  for (const key of edgeKeys) {
    const a = Math.floor(key / total)
    const b = key - a * total
    for (const vertex of [a, b]) {
      result[cursor++] = positions[vertex * 3]!
      result[cursor++] = positions[vertex * 3 + 1]!
      result[cursor++] = positions[vertex * 3 + 2]!
    }
  }
  return result
}

/**
 * Un segment par sommet : du sommet vers sommet + normale * `length`. Si le maillage a plus de
 * `maxSegments` sommets, on n'en prend qu'un sur k (le sommet 0, puis k, 2k...) avec
 * k = ceil(sommets / maxSegments) : l'échantillonnage est RÉGULIER (les normales restent réparties sur
 * tout l'objet, pas toutes au même endroit) et ne dépasse jamais `maxSegments`.
 *
 * Pourquoi cette valeur de k : ceil(n / k) est le nombre de sommets pris ; avec k >= n / max, on a
 * n / k <= max, donc ceil(n / k) <= max (max est entier).
 */
export function normalSegments(mesh: Mesh, length: number, maxSegments: number): Float32Array {
  if (!Number.isFinite(length) || length <= 0) {
    throw new RangeError(`Longueur de normale invalide : ${length} (attendu : un nombre strictement positif).`)
  }
  if (!Number.isInteger(maxSegments) || maxSegments < 1) {
    throw new RangeError(`Nombre maximal de normales invalide : ${maxSegments} (attendu : un entier d'au moins 1).`)
  }
  if (mesh.normals.length !== mesh.positions.length) {
    throw new RangeError(
      `Il faut une normale par sommet (${mesh.positions.length / 3} positions, ${mesh.normals.length / 3} normales).`,
    )
  }
  const total = vertexCount(mesh)
  if (total === 0) return new Float32Array(0)

  const step = Math.ceil(total / maxSegments)
  const result = new Float32Array(Math.ceil(total / step) * FLOATS_PER_SEGMENT)
  let cursor = 0
  for (let v = 0; v < total; v += step) {
    for (let axis = 0; axis < 3; axis++) {
      result[cursor + axis] = mesh.positions[v * 3 + axis]!
      result[cursor + 3 + axis] = mesh.positions[v * 3 + axis]! + mesh.normals[v * 3 + axis]! * length
    }
    cursor += FLOATS_PER_SEGMENT
  }
  return result
}

/**
 * Les 12 arêtes de la boîte alignée sur les axes qui contient les positions (voir `boundingBox`).
 * Un maillage sans sommet n'a pas de boîte : aucun segment.
 *
 * Les 8 coins sont numérotés de 0 à 7 : chaque bit dit, pour un axe, si on prend le min (0) ou le max
 * (1) : bit 0 pour X, bit 1 pour Y, bit 2 pour Z. Deux coins sont reliés par une arête de la boîte
 * exactement quand leurs numéros ne diffèrent que d'un bit : cela fait bien 12 paires (3 axes x 4).
 */
export function boundingBoxSegments(mesh: Mesh): Float32Array {
  const box = boundingBox(mesh)
  if (!box) return new Float32Array(0)

  const corner = (index: number) => [
    index & 1 ? box.max[0] : box.min[0],
    index & 2 ? box.max[1] : box.min[1],
    index & 4 ? box.max[2] : box.min[2],
  ]
  const result = new Float32Array(12 * FLOATS_PER_SEGMENT)
  let cursor = 0
  for (let index = 0; index < 8; index++) {
    for (const bit of [1, 2, 4]) {
      if (index & bit) continue // l'arête est comptée une fois, depuis son coin « min »
      result.set(corner(index), cursor)
      result.set(corner(index | bit), cursor + 3)
      cursor += FLOATS_PER_SEGMENT
    }
  }
  return result
}

/**
 * Une grille dans le plan XZ (horizontal) à la hauteur `y`, de côté 2 x `halfSize`, découpée en
 * `divisions` cases par côté. Il faut donc `divisions + 1` lignes dans chaque sens : le côté a deux
 * bords et `divisions - 1` lignes entre eux. Total : 2 x (divisions + 1) segments.
 */
export function gridSegments(halfSize: number, divisions: number, y: number): Float32Array {
  if (!Number.isFinite(halfSize) || halfSize <= 0) {
    throw new RangeError(`Demi-côté de grille invalide : ${halfSize} (attendu : un nombre strictement positif).`)
  }
  if (!Number.isInteger(divisions) || divisions < 1) {
    throw new RangeError(`Nombre de divisions invalide : ${divisions} (attendu : un entier d'au moins 1).`)
  }
  if (!Number.isFinite(y)) throw new RangeError(`Hauteur de grille invalide : ${y}.`)

  const result = new Float32Array(2 * (divisions + 1) * FLOATS_PER_SEGMENT)
  let cursor = 0
  for (let i = 0; i <= divisions; i++) {
    const t = -halfSize + (2 * halfSize * i) / divisions // de -halfSize à +halfSize
    // Une ligne parallèle à Z (x fixé à t), puis une ligne parallèle à X (z fixé à t).
    result.set([t, y, -halfSize, t, y, halfSize], cursor)
    cursor += FLOATS_PER_SEGMENT
    result.set([-halfSize, y, t, halfSize, y, t], cursor)
    cursor += FLOATS_PER_SEGMENT
  }
  return result
}

/**
 * Trois segments depuis l'origine, dans cet ordre : X, puis Y, puis Z (chacun de longueur `length`).
 * Le renderer en fait trois séries de couleurs différentes (rouge, vert, bleu).
 */
export function axesSegments(length: number): Float32Array {
  if (!Number.isFinite(length) || length <= 0) {
    throw new RangeError(`Longueur d'axes invalide : ${length} (attendu : un nombre strictement positif).`)
  }
  return new Float32Array([
    0, 0, 0, length, 0, 0, // X
    0, 0, 0, 0, length, 0, // Y
    0, 0, 0, 0, 0, length, // Z
  ])
}
