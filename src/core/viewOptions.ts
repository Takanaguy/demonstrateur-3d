/**
 * Options d'affichage de la vue, sans React ni WebGL. Chaque option est un simple booléen que
 * l'interface (case à cocher) modifie et que le renderer applique. Pour en ajouter une, il suffit
 * d'ajouter un champ ici (et sa valeur par défaut) : `Viewer3D` et `App` transmettent l'objet entier.
 */

export interface ViewOptions {
  /** L'objet tourne seul autour de l'axe vertical. Sans effet si l'utilisateur a demandé moins de mouvement. */
  autoRotate: boolean
  /**
   * Ne pas dessiner les triangles vus par l'arrière (face culling). Désactivé par défaut : un plan
   * ou un fichier OBJ ouvert doit rester visible des deux côtés (décision 13).
   */
  backfaceCulling: boolean
}

/** Réglages de départ : l'objet tourne et le culling est désactivé, comme avant l'arrivée de ces options. */
export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  autoRotate: true,
  backfaceCulling: false,
}
