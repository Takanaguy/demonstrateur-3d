/**
 * Calcul de la rotation automatique, sans React ni Three.js.
 *
 * On avance selon le temps écoulé (et non d'un pas fixe par image) : la vitesse reste la même
 * sur un écran à 60 Hz et sur un écran à 144 Hz.
 */

/** Plafond du temps écoulé pris en compte. Quand l'onglet est caché, le navigateur suspend les
 * animations : au retour, le temps écoulé serait de plusieurs secondes et le cube sauterait. */
export const MAX_DELTA_SECONDS = 0.1

export function advanceRotation(angle: number, deltaSeconds: number, radiansPerSecond: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return angle
  return angle + Math.min(deltaSeconds, MAX_DELTA_SECONDS) * radiansPerSecond
}
