import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_LIGHTING } from './core/lighting'
import type { Mesh } from './core/mesh'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from './core/viewOptions'
import { LightingPanel } from './ui/LightingPanel'
import { MeshPanel } from './ui/MeshPanel'
import { shapeLabel, useMeshSelection } from './ui/useMeshSelection'
import { ViewPanel } from './ui/ViewPanel'
import { Viewer3D } from './viewer/Viewer3D'

/**
 * Le message d'alerte quand une aide en traits est refusée. `reset` dit ce que le viewer a remis à sa
 * valeur sûre : un mode d'affichage (le fil de fer) ou une case (une aide). Le détail de la cause vient
 * de l'erreur elle-même (déjà en français : mémoire graphique, maillage trop gros...).
 */
function overlayErrorMessage(error: unknown, reset: Partial<ViewOptions>): string {
  const detail = error instanceof Error ? ` ${error.message}` : ''
  if (reset.displayMode) return `Le fil de fer n'a pas pu être affiché.${detail} L'affichage plein est conservé.`
  // Le nom de l'aide dans le message : si deux aides échouent dans la même image, les deux messages
  // doivent se distinguer.
  const failed = (Object.keys(reset) as (keyof ViewOptions)[]).find((key) => key in AID_FAILURES)
  const title = (failed && AID_FAILURES[failed]) ?? "Une aide d'affichage n'a pas pu être dessinée."
  return `${title}${detail} Cette aide a été désactivée.`
}

/** Le début du message pour chaque aide à cocher. */
const AID_FAILURES: Partial<Record<keyof ViewOptions, string>> = {
  showNormals: "Les normales n'ont pas pu être dessinées.",
  showBoundingBox: "La boîte englobante n'a pas pu être dessinée.",
  showGrid: "La grille n'a pas pu être dessinée.",
  showAxes: "Les axes n'ont pas pu être dessinés.",
}

export default function App() {
  const { selection, error, selectShape, loadFile, reportDisplayError } = useMeshSelection()
  const { mesh, source } = selection
  const name = source.kind === 'shape' ? shapeLabel(source.shape) : `fichier ${source.fileName}`
  // Les réglages d'éclairage vivent ici : le panneau les modifie, le Viewer3D les reçoit.
  const [lighting, setLighting] = useState(DEFAULT_LIGHTING)
  // Même principe pour les options de vue. La caméra, elle, vit dans le Viewer3D (elle change à
  // chaque mouvement de souris) : App lui envoie seulement un compteur, incrémenté pour la remettre
  // à sa position de départ.
  const [viewOptions, setViewOptions] = useState(DEFAULT_VIEW_OPTIONS)
  const [resetViewKey, setResetViewKey] = useState(0)
  // Les messages affichés si le viewer n'a pas pu dessiner une aide (fil de fer, normales...). Ils
  // retiennent le maillage auquel ils s'appliquent : un message sur un fichier de 600 000 triangles ne
  // doit pas rester affiché à côté du cube qu'on choisit ensuite. Plusieurs aides peuvent échouer dans
  // la même image : on garde tous les messages, pas seulement le dernier.
  const [viewError, setViewError] = useState<{ messages: string[]; mesh: Mesh } | null>(null)
  // Le maillage affiché, lu par le rappel d'erreur (qui est appelé depuis la boucle de dessin, hors
  // rendu React, et ne doit pas changer à chaque rendu : le viewer le retient dans une référence).
  const meshRef = useRef(mesh)
  useEffect(() => {
    meshRef.current = mesh
  }, [mesh])
  // Un message d'un autre maillage n'est plus affiché : on compare, plutôt que de le remettre à zéro dans un effet.
  const shownViewError = viewError && viewError.mesh === mesh ? viewError.messages.join(' ') : null

  // Une nouvelle action de l'utilisateur sur les options efface l'ancien message : il parlait d'un choix précédent.
  const changeViewOptions = (next: ViewOptions) => {
    setViewError(null)
    setViewOptions(next)
  }

  // Le viewer a déjà basculé sur un affichage sans l'aide refusée : on met les options et le panneau
  // en accord avec l'écran (pour que « Fil de fer » ne reste pas coché devant un objet plein), en ne
  // changeant que ce que le viewer a remis. Les autres choix de l'utilisateur sont gardés.
  const reportOverlayError = useCallback((error: unknown, reset: Partial<ViewOptions>) => {
    setViewOptions((current) => ({ ...current, ...reset }))
    const message = overlayErrorMessage(error, reset)
    const forMesh = meshRef.current
    setViewError((current) => {
      if (!current || current.mesh !== forMesh) return { messages: [message], mesh: forMesh }
      return current.messages.includes(message) ? current : { ...current, messages: [...current.messages, message] }
    })
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold text-slate-900">Démonstrateur 3D</h1>
      <p className="text-slate-600">
        Une forme de base ou un fichier OBJ, éclairés, dessinés en WebGL2 écrit à la main, sans moteur 3D. On tourne autour
        à la souris, au doigt ou au clavier.
      </p>
      {/* La 3D est placée AVANT les panneaux et collée en haut de l'écran sur petit écran : sur mobile
          les panneaux sont empilés sous elle, et sans cela on ne verrait plus l'effet d'un réglage
          dès qu'on descend le changer. À partir de `md` elle redevient normale (`md:static`) : un
          canvas collé aussi grand mangerait trop de hauteur d'écran. Le fond blanc et le petit
          espacement évitent que le texte qui défile derrière ne se voie autour du canvas.
          Plafond de hauteur (`max-h-[45vh]`, retiré à partir de `md`) : en 16/9 sur toute la
          largeur, un téléphone tenu en paysage (667 x 375) aurait une 3D collée de 364 px qui
          recouvrirait tout l'écran. Avec le plafond, la largeur reste celle de l'écran et la hauteur
          s'arrête à 45 % de l'écran : le canvas devient plus large que 16/9 mais n'est pas déformé,
          car le composant lit sa taille réelle (clientWidth, clientHeight) pour la résolution et la
          projection. Le `scroll-padding-top` de index.css reprend la même hauteur : si l'un change,
          l'autre aussi. */}
      <div className="sticky top-0 z-10 bg-white py-2 md:static md:py-0">
        <Viewer3D
          className="aspect-video max-h-[45vh] w-full rounded-lg md:max-h-none"
          mesh={mesh}
          lighting={lighting}
          viewOptions={viewOptions}
          resetViewKey={resetViewKey}
          label={`Objet affiché en 3D : ${name}`}
          onMeshError={reportDisplayError}
          onOverlayError={reportOverlayError}
        />
      </div>
      {/* Une colonne sur mobile (les trois panneaux empilés), deux colonnes dès l'écran moyen :
          maillage puis vue à gauche, éclairage (le plus haut, avec ses curseurs) à droite sur deux
          lignes. `items-start` : chaque panneau garde sa hauteur au lieu de s'étirer. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        <MeshPanel mesh={mesh} source={source} error={error} onSelectShape={selectShape} onLoadFile={loadFile} />
        <div className="md:row-span-2">
          <LightingPanel settings={lighting} onChange={setLighting} />
        </div>
        <ViewPanel
          options={viewOptions}
          onChange={changeViewOptions}
          onResetCamera={() => setResetViewKey((key) => key + 1)}
          error={shownViewError}
        />
      </div>
    </main>
  )
}
