import { useId, useSyncExternalStore } from 'react'
import { MAX_EDGE_TRIANGLES, MAX_NORMAL_SEGMENTS } from '../core/overlays'
import { DISPLAY_MODES, type DisplayMode, type ViewOptions } from '../core/viewOptions'

interface ViewPanelProps {
  options: ViewOptions
  onChange: (options: ViewOptions) => void
  onResetCamera: () => void
  /** Message d'erreur d'une aide que le GPU a refusée (fil de fer, par exemple), ou null. */
  error?: string | null
}

/** Le nom de chaque mode d'affichage tel qu'il est écrit dans l'interface. */
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  solid: 'Plein',
  wireframe: 'Fil de fer',
  'solid-wireframe': 'Plein et fil de fer',
}

/** Nombres écrits à la française, avec une espace entre les milliers : « 4 000 ». */
const numberFormat = new Intl.NumberFormat('fr-FR')

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const BUTTON_CLASSES =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50'

/**
 * S'abonne aux changements du réglage système « moins de mouvement ». `matchMedia` peut manquer
 * (jsdom, très vieux navigateurs) et un faux `matchMedia` peut ne pas avoir `addEventListener` :
 * dans ces cas on ne s'abonne à rien et le réglage est considéré comme absent.
 */
function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY)
  query?.addEventListener?.('change', onChange)
  return () => query?.removeEventListener?.('change', onChange)
}

function readReducedMotion(): boolean {
  return window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches ?? false
}

/**
 * Le panneau de la vue : rotation automatique, face culling, mode d'affichage (plein, fil de fer),
 * aides (normales, boîte englobante, grille, axes), retour de la caméra à sa position de départ, et
 * rappel des commandes. Comme les autres panneaux il est contrôlé : il affiche `options` et prévient
 * `App` par `onChange` avec de NOUVELLES options (jamais de modification sur place).
 */
export function ViewPanel({ options, onChange, onResetCamera, error }: ViewPanelProps) {
  const cullingHelpId = useId()
  const motionHelpId = useId()
  const displayHelpId = useId()
  const normalsHelpId = useId()
  const gridHelpId = useId()
  const axesHelpId = useId()
  // Lu ici (et pas dans Viewer3D) car `ui` ne doit rien importer de `viewer`. Si le réglage change
  // pendant que la page est ouverte, le panneau se met à jour tout seul.
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, readReducedMotion)

  return (
    <section aria-label="Réglages de la vue" className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              checked={options.autoRotate}
              aria-describedby={reducedMotion ? motionHelpId : undefined}
              onChange={(event) => onChange({ ...options, autoRotate: event.target.checked })}
            />
            Rotation automatique de l'objet
          </label>
          {/* Affichée seulement quand le système demande moins de mouvement : la case reste cochée
              (c'est le choix de l'utilisateur) mais rien ne tourne, il faut le dire. */}
          {reducedMotion && (
            <p id={motionHelpId} className="text-sm text-slate-600">
              Votre système demande moins de mouvement : l'objet ne tourne pas seul, même si cette case est cochée.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              checked={options.backfaceCulling}
              aria-describedby={cullingHelpId}
              onChange={(event) => onChange({ ...options, backfaceCulling: event.target.checked })}
            />
            Masquer les faces vues de dos (culling)
          </label>
          <p id={cullingHelpId} className="text-sm text-slate-600">
            Attention : un fichier OBJ dont les triangles sont dans le mauvais sens devient invisible quand cette
            option est active.
          </p>
        </div>
      </div>

      {/* `fieldset` et `legend` : un lecteur d'écran annonce le nom du groupe avant chaque choix. L'aide est
          reliée au groupe par aria-describedby (elle est lue en entrant dans le groupe). */}
      <fieldset className="flex flex-col gap-2" aria-describedby={displayHelpId}>
        <legend className="mb-1 text-sm font-semibold text-slate-900">Affichage</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {DISPLAY_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-1.5 text-slate-800">
              <input
                type="radio"
                name="display-mode"
                value={mode}
                checked={options.displayMode === mode}
                onChange={() => onChange({ ...options, displayMode: mode })}
              />
              {DISPLAY_MODE_LABELS[mode]}
            </label>
          ))}
        </div>
        <p id={displayHelpId} className="text-sm text-slate-600">
          Le fil de fer montre les arêtes de tous les triangles, y compris les diagonales des faces (jusqu'à{' '}
          {numberFormat.format(MAX_EDGE_TRIANGLES)} triangles). Les traits font toujours 1 pixel de large.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Aides</legend>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              checked={options.showNormals}
              aria-describedby={normalsHelpId}
              onChange={(event) => onChange({ ...options, showNormals: event.target.checked })}
            />
            Normales des sommets
          </label>
          <p id={normalsHelpId} className="text-sm text-slate-600">
            Un segment par sommet, échantillonné au-delà de {numberFormat.format(MAX_NORMAL_SEGMENTS)} sommets (un
            sommet sur k).
          </p>
        </div>

        <label className="flex items-center gap-2 text-slate-800">
          <input
            type="checkbox"
            checked={options.showBoundingBox}
            onChange={(event) => onChange({ ...options, showBoundingBox: event.target.checked })}
          />
          Boîte englobante
        </label>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              checked={options.showGrid}
              aria-describedby={gridHelpId}
              onChange={(event) => onChange({ ...options, showGrid: event.target.checked })}
            />
            Grille
          </label>
          <p id={gridHelpId} className="text-sm text-slate-600">
            Une grille horizontale sous l'objet, fixe dans le monde : elle ne tourne pas avec lui.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              checked={options.showAxes}
              aria-describedby={axesHelpId}
              onChange={(event) => onChange({ ...options, showAxes: event.target.checked })}
            />
            Axes
          </label>
          <p id={axesHelpId} className="text-sm text-slate-600">
            X en rouge, Y en vert, Z en bleu, depuis le centre de l'objet. Fixes dans le monde.
          </p>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div>
        <button type="button" className={BUTTON_CLASSES} onClick={onResetCamera}>
          Réinitialiser la caméra
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Pour tourner autour de l'objet : glisser avec la souris ou le doigt, ou flèches du clavier. Pour zoomer :
        molette, ou touches + et - (l'image doit avoir le focus). Le pincement à deux doigts n'est pas géré.
      </p>
    </section>
  )
}
