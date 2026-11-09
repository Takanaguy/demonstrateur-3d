import { useState } from 'react'
import { DEFAULT_LIGHTING } from './core/lighting'
import { DEFAULT_VIEW_OPTIONS } from './core/viewOptions'
import { LightingPanel } from './ui/LightingPanel'
import { MeshPanel } from './ui/MeshPanel'
import { shapeLabel, useMeshSelection } from './ui/useMeshSelection'
import { ViewPanel } from './ui/ViewPanel'
import { Viewer3D } from './viewer/Viewer3D'

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
          onChange={setViewOptions}
          onResetCamera={() => setResetViewKey((key) => key + 1)}
        />
      </div>
    </main>
  )
}
