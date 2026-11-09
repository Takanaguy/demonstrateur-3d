import { useId, useSyncExternalStore } from 'react'
import type { ViewOptions } from '../core/viewOptions'

interface ViewPanelProps {
  options: ViewOptions
  onChange: (options: ViewOptions) => void
  onResetCamera: () => void
}

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
 * Le panneau de la vue : rotation automatique, face culling, retour de la caméra à sa position de
 * départ, et rappel des commandes. Comme les autres panneaux il est contrôlé : il affiche `options`
 * et prévient `App` par `onChange` avec de NOUVELLES options (jamais de modification sur place).
 */
export function ViewPanel({ options, onChange, onResetCamera }: ViewPanelProps) {
  const cullingHelpId = useId()
  const motionHelpId = useId()
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
