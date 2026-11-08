/**
 * Matrices 4x4 (transformations 3D) et 3x3 (matrice normale), en TypeScript pur : aucun import
 * de React ni de WebGL. Tout se teste donc avec de simples nombres.
 *
 * POURQUOI COLONNES-MAJEURES. WebGL attend une matrice sous forme d'un tableau plat de 16
 * nombres rangés colonne après colonne : les 4 premiers sont la première colonne, etc. L'élément
 * de la ligne `r` et de la colonne `c` est donc à l'indice `c * 4 + r`. En gardant ce même
 * rangement ici, on envoie le `Float32Array` tel quel au GPU, sans transposer. Quand on écrit un
 * tableau littéral ci-dessous, chaque groupe de 4 nombres est donc une COLONNE, pas une ligne.
 *
 * POURQUOI Float32Array. Le GPU travaille en flottants 32 bits : on calcule dans le même format
 * que celui qui sera envoyé, sans conversion.
 *
 * CONVENTION. Les points sont des colonnes : `p' = M * p`. Dans `multiply(a, b)`, la
 * transformation `b` est donc appliquée EN PREMIER, puis `a`. Pour un objet on compose
 * `projection * vue * modèle`, de gauche à droite.
 */

import { cross, dot, normalize, subtract, type Vec3 } from './vec3'

/** Matrice 4x4 : 16 nombres, colonnes-majeures. */
export type Mat4 = Float32Array
/** Matrice 3x3 : 9 nombres, colonnes-majeures. */
export type Mat3 = Float32Array

/** Matrice identité : ne change rien. C'est l'élément neutre de la multiplication. */
export function identity(): Mat4 {
  // Les 1 sont sur la diagonale (indices 0, 5, 10, 15).
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/**
 * Produit `a * b`. L'élément (ligne r, colonne c) est le produit scalaire de la ligne r de `a`
 * par la colonne c de `b`. Le produit de matrices n'est PAS commutatif : l'ordre compte.
 */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!
      }
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** Translation : déplace tout de (x, y, z). Le déplacement est dans la 4e colonne. */
export function translation(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
}

/** Mise à l'échelle : multiplie chaque axe par son facteur (non uniforme si les trois diffèrent). */
export function scale(x: number, y: number, z: number): Mat4 {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
}

/** Rotation d'un angle (en radians) autour de l'axe X. Sens direct (règle de la main droite). */
export function rotationX(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // Colonnes : X reste X ; Y part vers Z ; Z part vers -Y.
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
}

/** Rotation autour de l'axe Y (l'axe vertical). */
export function rotationY(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // Colonnes : X part vers -Z ; Y reste Y ; Z part vers X.
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
}

/** Rotation autour de l'axe Z (l'axe qui pointe vers l'observateur). */
export function rotationZ(angle: number): Mat4 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // Colonnes : X part vers Y ; Y part vers -X ; Z reste Z.
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/**
 * Projection en perspective : écrase la pyramide de vision (le « frustum ») dans le cube
 * [-1, 1]^3 que WebGL sait dessiner. Ce qui est loin paraît plus petit.
 *
 * - `fovY` : ouverture verticale du champ de vision, en radians.
 * - `aspect` : largeur / hauteur de l'image. Sans lui, l'image serait étirée.
 * - `near`, `far` : distances des plans de coupe. Tout ce qui est hors de [near, far] n'est pas dessiné.
 *
 * Avec f = 1 / tan(fovY / 2), la matrice (écrite en lignes pour la lisibilité) est :
 *   [ f/aspect  0   0                      0                     ]
 *   [ 0         f   0                      0                     ]
 *   [ 0         0   (far+near)/(near-far)  2*far*near/(near-far) ]
 *   [ 0         0   -1                     0                     ]
 * La dernière ligne copie -z dans w : le GPU divise ensuite x, y, z par w, c'est cette division
 * qui produit la perspective. La caméra regarde vers -Z (convention OpenGL).
 *
 * Lève une `RangeError` si les paramètres sont invalides : un aspect nul ou NaN, ou near >= far,
 * donneraient une matrice pleine de NaN ou d'infinis et un écran vide, sans aucun message.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  if (!Number.isFinite(fovY) || fovY <= 0 || fovY >= Math.PI) {
    throw new RangeError(`Champ de vision invalide : ${fovY} (attendu : entre 0 et PI, en radians).`)
  }
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(`Rapport largeur/hauteur invalide : ${aspect} (attendu : un nombre strictement positif).`)
  }
  if (!Number.isFinite(near) || !Number.isFinite(far) || near <= 0 || near >= far) {
    throw new RangeError(`Plans de coupe invalides : near = ${near}, far = ${far} (attendu : 0 < near < far).`)
  }
  const f = 1 / Math.tan(fovY / 2)
  const rangeInverse = 1 / (near - far)
  // Chaque ligne ci-dessous est une COLONNE de la matrice.
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * rangeInverse, -1,
    0, 0, 2 * far * near * rangeInverse, 0,
  ])
}

/**
 * Matrice de vue : place la caméra. Elle exprime le monde dans le repère de la caméra, c'est
 * l'INVERSE du déplacement de la caméra (bouger la caméra vers la droite revient à bouger tout
 * le monde vers la gauche).
 *
 * On construit un repère orthonormé de la caméra :
 * - `f` (« forward ») : direction du regard, de l'œil vers la cible ;
 * - `s` (« side ») : le côté droit, f x up ;
 * - `u` : le haut réel de la caméra, s x f (corrigé pour être perpendiculaire à f).
 * La caméra regarde vers -Z, donc la 3e ligne contient -f. La dernière colonne translate le monde
 * pour mettre l'œil à l'origine : -dot(axe, œil) pour chaque axe.
 *
 * Lève une `RangeError` si l'œil est sur la cible (pas de direction de regard) ou si `up` est
 * parallèle au regard (on ne sait plus où est la droite) ou nul.
 */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = normalize(subtract(target, eye)) // lève déjà une erreur si l'œil est sur la cible
  const sideRaw = cross(f, up)
  // Si `up` est parallèle (ou presque) à f, le produit vectoriel est nul (ou minuscule).
  const upLength = Math.hypot(up[0], up[1], up[2])
  if (Math.hypot(sideRaw[0], sideRaw[1], sideRaw[2]) <= 1e-6 * upLength) {
    throw new RangeError('lookAt : la direction « haut » est nulle ou parallèle à la direction du regard.')
  }
  const s = normalize(sideRaw)
  const u = cross(s, f)
  // Chaque ligne ci-dessous est une COLONNE de la matrice.
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ])
}

/**
 * Matrice normale (3x3) : l'inverse transposée de la partie 3x3 du modèle.
 *
 * Pourquoi pas simplement la matrice modèle ? Avec une mise à l'échelle non uniforme (par exemple
 * étirer un objet en largeur), appliquer la matrice modèle à une normale la rend inclinée par
 * rapport à la surface : elle n'est plus perpendiculaire, et l'éclairage est faux. L'inverse
 * transposée garde la perpendicularité. Pour une simple rotation, c'est la même matrice. La
 * translation ne concerne pas les directions : on ignore la 4e colonne.
 *
 * Calcul sans boucle : si les colonnes de M sont a, b, c, alors les LIGNES de son inverse sont
 * (b x c, c x a, a x b) / det, avec det = a . (b x c). Transposer, c'est lire ces lignes comme
 * des colonnes : la matrice normale a donc pour colonnes (b x c, c x a, a x b) / det.
 * Le résultat n'est pas forcément de longueur 1 : le shader renormalise la normale.
 *
 * Lève une `RangeError` si le modèle n'est pas inversible (déterminant nul : un axe écrasé à 0).
 */
export function normalMatrix(model: Mat4): Mat3 {
  const a: Vec3 = [model[0]!, model[1]!, model[2]!]
  const b: Vec3 = [model[4]!, model[5]!, model[6]!]
  const c: Vec3 = [model[8]!, model[9]!, model[10]!]
  const det = dot(a, cross(b, c))
  if (det === 0 || !Number.isFinite(det)) {
    throw new RangeError("normalMatrix : la matrice modèle n'est pas inversible (déterminant nul ou invalide).")
  }
  const col0 = cross(b, c)
  const col1 = cross(c, a)
  const col2 = cross(a, b)
  return new Float32Array([
    col0[0] / det, col0[1] / det, col0[2] / det,
    col1[0] / det, col1[1] / det, col1[2] / det,
    col2[0] / det, col2[1] / det, col2[2] / det,
  ])
}
