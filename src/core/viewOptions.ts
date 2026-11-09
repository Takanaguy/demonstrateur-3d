/**
 * Options d'affichage de la vue, sans React ni WebGL. Chaque option est un simple choix que
 * l'interface (case à cocher, bouton radio) modifie et que le renderer applique. Pour en ajouter une,
 * il suffit d'ajouter un champ ici (et sa valeur par défaut) : `Viewer3D` et `App` transmettent
 * l'objet entier.
 */

/**
 * Comment l'objet est dessiné :
 * - `solid` : les surfaces pleines et éclairées ;
 * - `wireframe` : seulement les arêtes des triangles (fil de fer), sans remplissage ;
 * - `solid-wireframe` : les surfaces ET les arêtes par-dessus.
 */
export type DisplayMode = 'solid' | 'wireframe' | 'solid-wireframe'

/** Les modes proposés dans l'interface, dans l'ordre d'affichage. */
export const DISPLAY_MODES: readonly DisplayMode[] = ['solid', 'wireframe', 'solid-wireframe']

/** Vrai si ce mode dessine les surfaces pleines (le remplissage éclairé). */
export function drawsFill(mode: DisplayMode): boolean {
  return mode === 'solid' || mode === 'solid-wireframe'
}

/** Vrai si ce mode dessine les arêtes des triangles. */
export function drawsEdges(mode: DisplayMode): boolean {
  return mode === 'wireframe' || mode === 'solid-wireframe'
}

export interface ViewOptions {
  /** L'objet tourne seul autour de l'axe vertical. Sans effet si l'utilisateur a demandé moins de mouvement. */
  autoRotate: boolean
  /**
   * Ne pas dessiner les triangles vus par l'arrière (face culling). Désactivé par défaut : un plan
   * ou un fichier OBJ ouvert doit rester visible des deux côtés (décision 13).
   */
  backfaceCulling: boolean
  /** Surfaces pleines, fil de fer, ou les deux (décision 19). */
  displayMode: DisplayMode
  /** Un petit segment par sommet (échantillonné sur les gros maillages), dans le sens de sa normale. */
  showNormals: boolean
  /** Les douze arêtes de la boîte alignée sur les axes qui contient l'objet. */
  showBoundingBox: boolean
  /** Une grille horizontale sous l'objet, fixe dans le monde. */
  showGrid: boolean
  /** Les trois axes du monde depuis l'origine : X rouge, Y vert, Z bleu. */
  showAxes: boolean
}

/**
 * Réglages de départ : l'objet tourne, le culling est désactivé et l'objet est plein, sans aucune
 * aide dessinée : c'est l'affichage d'avant l'arrivée de ces options.
 */
export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  autoRotate: true,
  backfaceCulling: false,
  displayMode: 'solid',
  showNormals: false,
  showBoundingBox: false,
  showGrid: false,
  showAxes: false,
}
