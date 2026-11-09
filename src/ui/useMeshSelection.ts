import { useCallback, useRef, useState } from 'react'
import type { Mesh } from '../core/mesh'
import { MAX_OBJ_TEXT_LENGTH, ObjParseError, parseObj } from '../core/obj'
import { createShape, type ShapeId } from '../core/shapes'

/** D'où vient le maillage affiché : une forme générée par le code, ou un fichier de l'utilisateur. */
export type MeshSource = { kind: 'shape'; shape: ShapeId } | { kind: 'file'; fileName: string }

export interface MeshSelection {
  mesh: Mesh
  source: MeshSource
}

/**
 * Taille maximale du fichier, en octets, vérifiée AVANT de le lire. Même valeur que la limite du
 * texte de l'analyseur : un caractère prend au moins un octet en UTF-8, donc un fichier qui passe
 * ce contrôle ne peut pas dépasser la limite de l'analyseur en caractères.
 */
export const MAX_OBJ_FILE_BYTES = MAX_OBJ_TEXT_LENGTH

const SHAPE_LABELS: Record<ShapeId, string> = {
  cube: 'Cube',
  sphere: 'Sphère',
  plane: 'Plan',
  cone: 'Cône',
}

/** Nom lisible d'une forme, pour les boutons et les messages. */
export function shapeLabel(shape: ShapeId): string {
  return SHAPE_LABELS[shape]
}

function shapeSelection(shape: ShapeId): MeshSelection {
  return { mesh: createShape(shape), source: { kind: 'shape', shape } }
}

/** Taille en Mo à une décimale, arrondie vers le HAUT : un fichier juste au-dessus de la limite ne doit pas s'afficher « 50,0 Mo pour un maximum de 50,0 Mo ». */
function formatMegabytes(bytes: number): string {
  const megabytes = Math.ceil((bytes / (1024 * 1024)) * 10) / 10
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1 }).format(megabytes)} Mo`
}

/**
 * L'état « quel maillage afficher » : la forme ou le fichier choisi, et le dernier message
 * d'erreur. Vit dans un hook pour que `App` reste lisible et que la logique de chargement (qui
 * est asynchrone) soit à un seul endroit.
 */
export function useMeshSelection() {
  const [selection, setSelection] = useState<MeshSelection>(() => shapeSelection('cube'))
  const [error, setError] = useState<string | null>(null)
  // La sélection d'avant : si le GPU refuse la nouvelle, on y revient pour que le panneau décrive
  // bien ce qui est à l'écran.
  const previousRef = useRef(selection)
  // Numéro du dernier chargement demandé. Lire un fichier est asynchrone : si l'utilisateur change
  // d'avis pendant la lecture (autre forme, autre fichier), le résultat périmé est ignoré.
  const requestRef = useRef(0)

  const choose = (next: MeshSelection) => {
    previousRef.current = selection
    setSelection(next)
  }

  const selectShape = (shape: ShapeId) => {
    requestRef.current++
    setError(null)
    choose(shapeSelection(shape))
  }

  const loadFile = async (file: File) => {
    const request = ++requestRef.current

    // La taille est contrôlée AVANT la lecture : `file.text()` charge tout le contenu en mémoire,
    // ce qu'un fichier énorme transformerait en gel de l'onglet.
    if (file.size > MAX_OBJ_FILE_BYTES) {
      setError(
        `Fichier refusé : « ${file.name} » pèse ${formatMegabytes(file.size)}, le maximum est ${formatMegabytes(MAX_OBJ_FILE_BYTES)}.`,
      )
      return
    }

    // L'ancienne alerte ne doit pas rester affichée pendant la lecture du nouveau fichier : elle
    // parlerait d'un autre fichier. (Taille refusée : la nouvelle alerte remplace déjà l'ancienne.)
    setError(null)

    try {
      const mesh = parseObj(await file.text())
      if (request !== requestRef.current) return // un choix plus récent a pris la place
      setError(null)
      choose({ mesh, source: { kind: 'file', fileName: file.name } })
    } catch (caught) {
      if (request !== requestRef.current) return
      // Le message de l'analyseur est déjà en français et donne le numéro de ligne ; toute autre
      // erreur (fichier illisible, disparu depuis le choix) reçoit un message générique.
      setError(
        caught instanceof ObjParseError
          ? `Fichier refusé : ${caught.message}`
          : `Fichier refusé : « ${file.name} » n'a pas pu être lu.`,
      )
      // Le maillage précédent reste à l'écran : on ne touche pas à `selection`.
    }
  }

  /** Appelé par le viewer quand le GPU refuse le nouveau maillage : on revient à l'ancien. */
  const reportDisplayError = useCallback(() => {
    setSelection(previousRef.current)
    setError('Ce modèle n\'a pas pu être affiché (mémoire graphique insuffisante ?). Le précédent est conservé.')
  }, [])

  return { selection, error, selectShape, loadFile, reportDisplayError }
}
