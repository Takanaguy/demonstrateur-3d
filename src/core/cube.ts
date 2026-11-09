/**
 * Géométrie d'un cube, calculée à la main, sans React ni WebGL.
 *
 * POURQUOI 24 SOMMETS ET PAS 8. Un cube a 8 coins, mais chaque coin appartient à trois faces qui
 * n'ont pas la même normale. Or un sommet WebGL porte UNE seule normale. Pour avoir un éclairage
 * net (chaque face d'une seule teinte), on duplique donc chaque coin une fois par face :
 * 6 faces x 4 coins = 24 sommets. Avec 8 sommets partagés, la lumière se mélangerait sur les
 * arêtes et le cube paraîtrait arrondi.
 *
 * POURQUOI 36 INDICES. Une face est un carré, découpé en 2 triangles de 3 sommets, soit 6 indices
 * par face et 36 en tout. Les indices disent quels sommets relier : on évite de répéter les
 * coordonnées des sommets communs aux deux triangles.
 *
 * SENS DES TRIANGLES. Par défaut WebGL considère qu'un triangle est « de face » quand ses sommets
 * apparaissent dans le sens inverse des aiguilles d'une montre (CCW) vu de l'observateur. Avec le
 * face culling activé, les triangles vus par l'arrière (les faces cachées du cube) ne sont pas
 * dessinés. Il faut donc que chaque face soit ordonnée en CCW vue de l'EXTÉRIEUR du cube.
 */

import type { Mesh } from './mesh'
import { cross, type Vec3 } from './vec3'

/**
 * Pour chaque face : sa normale (vers l'extérieur) et un premier axe `u` dans le plan de la face.
 * Le second axe est `v = normale x u`, ce qui garantit u x v = normale : en parcourant
 * (-u,-v), (+u,-v), (+u,+v), (-u,+v), on tourne dans le sens inverse des aiguilles d'une montre
 * vu de l'extérieur.
 */
const FACES: readonly { normal: Vec3; u: Vec3 }[] = [
  { normal: [1, 0, 0], u: [0, 1, 0] }, // droite (+X)
  { normal: [-1, 0, 0], u: [0, 0, 1] }, // gauche (-X)
  { normal: [0, 1, 0], u: [0, 0, 1] }, // dessus (+Y)
  { normal: [0, -1, 0], u: [1, 0, 0] }, // dessous (-Y)
  { normal: [0, 0, 1], u: [1, 0, 0] }, // face avant (+Z)
  { normal: [0, 0, -1], u: [0, 1, 0] }, // face arrière (-Z)
]

/** Coins d'une face dans le repère (u, v), parcourus en sens inverse des aiguilles d'une montre. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

/**
 * Cube centré sur l'origine, de côté `size` : 24 sommets (positions et normales) et 36 indices
 * (12 triangles, indices dans [0, 24)). La normale d'un sommet est celle de sa face.
 */
export function createCubeGeometry(size = 1): Mesh {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`Taille de cube invalide : ${size} (attendu : un nombre strictement positif).`)
  }
  const half = size / 2
  const positions = new Float32Array(FACES.length * 4 * 3)
  const normals = new Float32Array(FACES.length * 4 * 3)
  const indices = new Uint16Array(FACES.length * 6)

  FACES.forEach(({ normal, u }, face) => {
    const v = cross(normal, u)
    CORNERS.forEach(([cu, cv], corner) => {
      const vertex = face * 4 + corner
      for (let axis = 0; axis < 3; axis++) {
        // Le centre de la face est à `half` le long de la normale ; on s'écarte de `half` selon u et v.
        positions[vertex * 3 + axis] = half * (normal[axis]! + cu * u[axis]! + cv * v[axis]!)
        normals[vertex * 3 + axis] = normal[axis]!
      }
    })
    // Le carré (0, 1, 2, 3) est coupé en deux triangles qui partagent la diagonale 0-2.
    const first = face * 4
    indices.set([first, first + 1, first + 2, first, first + 2, first + 3], face * 6)
  })

  return { positions, normals, indices }
}
