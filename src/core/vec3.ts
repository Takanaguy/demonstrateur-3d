/**
 * Petits calculs sur les vecteurs 3D, sans React ni WebGL.
 *
 * Un vecteur est un tuple en lecture seule `[x, y, z]` : léger, et TypeScript vérifie qu'il a
 * bien trois composantes. Chaque fonction renvoie un nouveau vecteur et ne modifie jamais ses
 * arguments, ce qui évite les effets de bord surprenants quand on réutilise un vecteur.
 */

export type Vec3 = readonly [number, number, number]

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Produit vectoriel : un vecteur perpendiculaire aux deux autres, dans le sens de la règle de la
 * main droite (cross([1,0,0], [0,1,0]) = [0,0,1]). Sert à construire des repères et à calculer
 * la normale d'un triangle.
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

/**
 * Renvoie le vecteur de même direction et de longueur 1.
 *
 * Le vecteur nul n'a pas de direction : diviser par sa longueur (0) donnerait NaN, qui se
 * propagerait ensuite dans toutes les matrices sans qu'on sache d'où il vient. On préfère lever
 * tout de suite une erreur claire.
 */
export function normalize(v: Vec3): Vec3 {
  const len = length(v)
  if (!Number.isFinite(len) || len === 0) {
    throw new RangeError(`Impossible de normaliser le vecteur [${v.join(', ')}] : longueur nulle ou invalide.`)
  }
  return [v[0] / len, v[1] / len, v[2] / len]
}
