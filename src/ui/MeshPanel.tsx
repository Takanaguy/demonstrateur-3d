import { useId } from 'react'
import { triangleCount, vertexCount, type Mesh } from '../core/mesh'
import { SHAPE_IDS, type ShapeId } from '../core/shapes'
import { shapeLabel, type MeshSource } from './useMeshSelection'

interface MeshPanelProps {
  mesh: Mesh
  source: MeshSource
  /** Message d'erreur du dernier chargement refusé, ou null. */
  error: string | null
  onSelectShape: (shape: ShapeId) => void
  onLoadFile: (file: File) => void
}

const numberFormat = new Intl.NumberFormat('fr-FR')

const BUTTON_CLASSES =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-white'

/**
 * Le panneau de choix du maillage : forme de base, fichier OBJ, statistiques, erreur. Ne contient
 * aucune logique de chargement : il affiche l'état reçu et prévient `App` des actions.
 */
export function MeshPanel({ mesh, source, error, onSelectShape, onLoadFile }: MeshPanelProps) {
  const fileInputId = useId()
  const showingCube = source.kind === 'shape' && source.shape === 'cube'

  return (
    <section aria-label="Choix de l'objet affiché" className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Forme</legend>
        {SHAPE_IDS.map((shape) => (
          <label key={shape} className="flex items-center gap-1.5 text-slate-800">
            <input
              type="radio"
              name="shape"
              value={shape}
              // Aucune case cochée quand c'est un fichier qui est affiché : aucune forme n'est active.
              checked={source.kind === 'shape' && source.shape === shape}
              onChange={() => onSelectShape(shape)}
            />
            {shapeLabel(shape)}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={fileInputId} className="text-sm font-semibold text-slate-900">
          Charger un fichier .obj
        </label>
        <input
          id={fileInputId}
          type="file"
          accept=".obj"
          className="text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Vider l'input : sans cela, choisir une deuxième fois le même fichier ne déclenche
            // aucun événement `change` (la valeur n'a pas changé) et on ne pourrait pas le recharger.
            event.target.value = ''
            if (file) onLoadFile(file)
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-700">
        <p>
          Affiché : <strong>{source.kind === 'shape' ? shapeLabel(source.shape) : `fichier ${source.fileName}`}</strong>
        </p>
        <ul className="flex gap-4">
          <li>Sommets : {numberFormat.format(vertexCount(mesh))}</li>
          <li>Triangles : {numberFormat.format(triangleCount(mesh))}</li>
        </ul>
        {/* `aria-disabled` et non `disabled` : un bouton `disabled` perd le focus clavier à l'instant
            où il se désactive (juste après son propre clic), et l'utilisateur au clavier est renvoyé
            au début de la page. Ici il garde le focus ; le clic est ignoré dans le gestionnaire. */}
        <button
          type="button"
          className={BUTTON_CLASSES}
          aria-disabled={showingCube || undefined}
          onClick={() => {
            if (!showingCube) onSelectShape('cube')
          }}
        >
          Revenir au cube
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  )
}
