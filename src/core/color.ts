/**
 * Conversion d'une couleur CSS écrite « #RRGGBB » en trois nombres entre 0 et 1.
 *
 * C'est le format qu'attend un shader (`vec3`) : chaque canal est un flottant entre 0 (éteint) et
 * 1 (plein). On garde les couleurs du projet en hexadécimal dans le code (comme dans la charte
 * graphique) et on convertit au dernier moment.
 */

import type { Vec3 } from './vec3'

export function parseHexColor(hex: string): Vec3 {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) {
    throw new RangeError(`Couleur invalide : « ${hex} » (attendu : #RRGGBB).`)
  }
  // `match[1]!` : l'expression régulière garantit que les trois groupes existent.
  return [parseInt(match[1]!, 16) / 255, parseInt(match[2]!, 16) / 255, parseInt(match[3]!, 16) / 255]
}
