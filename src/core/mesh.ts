/**
 * Le maillage (« mesh ») : la forme commune de tout ce qu'on sait afficher, qu'il vienne d'un
 * générateur du code (cube, sphère...) ou d'un fichier OBJ. Sans React ni WebGL.
 *
 * Un maillage est un ensemble de SOMMETS (une position et une normale chacun) reliés en
 * TRIANGLES par une liste d'indices. Les trois tableaux sont rangés à plat, dans le format que le
 * GPU attend, pour être envoyés tels quels :
 * - `positions` : x, y, z de chaque sommet (3 flottants par sommet) ;
 * - `normals`   : la normale de chaque sommet (3 flottants par sommet, longueur 1) ;
 * - `indices`   : trois indices de sommets par triangle, dans le sens inverse des aiguilles d'une
 *                 montre vu de l'EXTÉRIEUR de l'objet.
 */

import { cross, normalize, subtract, type Vec3 } from './vec3'

export interface Mesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint16Array | Uint32Array
}

/** Boîte alignée sur les axes qui contient tous les sommets. */
export interface BoundingBox {
  min: Vec3
  max: Vec3
}

/**
 * Plus grand nombre de sommets qu'un maillage peut avoir en gardant des indices 16 bits.
 * Un `Uint16Array` sait compter jusqu'à 65 535 inclus, mais l'indice 65 535 est aussi la valeur
 * « redémarrage de primitive » de WebGL2 (toujours active pour les rubans de triangles). Par
 * prudence, dès qu'il existe un sommet d'indice 65 535, on passe en 32 bits.
 */
export const MAX_VERTICES_UINT16 = 65_535

/** Nombre de sommets (une position = 3 flottants). */
export function vertexCount(mesh: Mesh): number {
  return mesh.positions.length / 3
}

/** Nombre de triangles (3 indices chacun). */
export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3
}

/**
 * Crée un tableau d'indices du bon type pour un maillage de `vertexCount` sommets : 16 bits tant
 * que possible (deux fois moins de mémoire GPU), 32 bits au-delà. Sans cela, un indice trop grand
 * serait tronqué sans erreur par `Uint16Array`, et le dessin serait faux.
 */
export function createIndexArray(length: number, vertexCount: number): Uint16Array | Uint32Array {
  return vertexCount > MAX_VERTICES_UINT16 ? new Uint32Array(length) : new Uint16Array(length)
}

/**
 * Plus petite boîte alignée sur les axes qui contient tous les sommets, ou `null` pour un
 * maillage vide : un maillage sans sommet n'a pas de boîte, et inventer (0, 0, 0) ferait croire
 * qu'il y a un point à l'origine.
 */
export function boundingBox(mesh: Mesh): BoundingBox | null {
  const { positions } = mesh
  if (positions.length < 3) return null
  const min: [number, number, number] = [positions[0]!, positions[1]!, positions[2]!]
  const max: [number, number, number] = [positions[0]!, positions[1]!, positions[2]!]
  for (let i = 3; i + 2 < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis]!
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max }
}

/**
 * Centre le maillage sur l'origine et le met à l'échelle pour qu'il tienne dans un cube de côté 2
 * (de -1 à +1 sur chaque axe). Renvoie un NOUVEAU maillage, l'original n'est pas modifié.
 *
 * POURQUOI. Un fichier OBJ n'a pas d'unité : un modèle peut mesurer 2 centimètres ou 2000
 * unités, et être décalé loin de l'origine. La caméra, elle, est fixe. En ramenant tout dans la
 * même boîte, n'importe quel fichier est visible en entier.
 *
 * UNE SEULE échelle pour les trois axes : on divise par la plus grande dimension de la boîte, pas
 * axe par axe, sinon l'objet serait déformé (une voiture écrasée en cube). Le plus grand côté
 * vaut alors exactement 2, les autres sont plus petits ou égaux.
 *
 * Les normales ne changent pas : une translation ne les touche pas, et une échelle uniforme ne
 * change que leur longueur, déjà normalisée dans le shader. Les indices non plus.
 *
 * Cas dégénérés, traités explicitement :
 * - maillage sans sommet : rien à centrer, on renvoie une copie vide (pas d'exception) ;
 * - boîte de taille nulle (tous les sommets au même point) : on centre sur l'origine mais on ne
 *   met pas à l'échelle, car diviser par 0 donnerait des NaN. L'objet est alors un simple point.
 */
export function normalizeToUnitBox(mesh: Mesh): Mesh {
  const box = boundingBox(mesh)
  if (!box) {
    return { positions: new Float32Array(0), normals: mesh.normals.slice(), indices: mesh.indices.slice() }
  }

  const center: Vec3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ]
  const largestSide = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2])
  // Le côté du cube cible est 2 : le plus grand côté de l'objet doit valoir 2.
  const scale = largestSide > 0 ? 2 / largestSide : 1

  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < positions.length; i++) {
    positions[i] = (mesh.positions[i]! - center[i % 3]!) * scale
  }
  return { positions, normals: mesh.normals.slice(), indices: mesh.indices.slice() }
}

/**
 * Calcule une normale « lisse » par sommet : la moyenne des normales des triangles qui touchent
 * ce sommet, chaque triangle comptant proportionnellement à son aire.
 *
 * POURQUOI LISSE. Un fichier OBJ sans normales ne dit rien sur la surface. Donner à chaque
 * sommet la normale de son triangle donnerait un aspect facetté. En moyennant les normales des
 * triangles voisins, la lumière varie progressivement d'un triangle à l'autre et une sphère
 * paraît ronde. Le prix : les arêtes vives (le cube) sont adoucies à tort.
 *
 * POURQUOI L'AIRE. Le produit vectoriel de deux côtés d'un triangle est perpendiculaire à ce
 * triangle ET sa longueur vaut le double de son aire. Additionner ces vecteurs bruts pondère donc
 * automatiquement par l'aire : un grand triangle compte plus que les petits éclats voisins.
 *
 * Un sommet dont la somme est nulle (aucun triangle, triangles d'aire nulle, ou normales qui
 * s'annulent exactement) reçoit la normale arbitraire +Y plutôt qu'un NaN : le shader divise par
 * la longueur de la normale, et un vecteur nul planterait l'éclairage de tout le triangle.
 */
export function computeSmoothNormals(positions: Float32Array, indices: Uint16Array | Uint32Array): Float32Array {
  // Float64Array pour la somme : additionner beaucoup de petits vecteurs en 32 bits perdrait en précision.
  const sums = new Float64Array(positions.length)
  const point = (index: number): Vec3 => [positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!]

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t]!
    const ib = indices[t + 1]!
    const ic = indices[t + 2]!
    const a = point(ia)
    const faceVector = cross(subtract(point(ib), a), subtract(point(ic), a))
    for (const index of [ia, ib, ic]) {
      sums[index * 3]! += faceVector[0]
      sums[index * 3 + 1]! += faceVector[1]
      sums[index * 3 + 2]! += faceVector[2]
    }
  }

  const normals = new Float32Array(positions.length)
  for (let i = 0; i < normals.length; i += 3) {
    const sum: Vec3 = [sums[i]!, sums[i + 1]!, sums[i + 2]!]
    const unit = isNullOrInvalid(sum) ? ([0, 1, 0] as const) : normalize(sum)
    normals.set(unit, i)
  }
  return normals
}

/** Vrai si le vecteur n'a pas de direction exploitable (nul, NaN ou infini). */
function isNullOrInvalid(v: Vec3): boolean {
  const len = Math.hypot(v[0], v[1], v[2])
  return !Number.isFinite(len) || len === 0
}
