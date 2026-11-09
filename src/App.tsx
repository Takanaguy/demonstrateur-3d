import { useState } from 'react'
import { DEFAULT_LIGHTING } from './core/lighting'
import { LightingPanel } from './ui/LightingPanel'
import { MeshPanel } from './ui/MeshPanel'
import { shapeLabel, useMeshSelection } from './ui/useMeshSelection'
import { Viewer3D } from './viewer/Viewer3D'

export default function App() {
  const { selection, error, selectShape, loadFile, reportDisplayError } = useMeshSelection()
  const { mesh, source } = selection
  const name = source.kind === 'shape' ? shapeLabel(source.shape) : `fichier ${source.fileName}`
  // Les réglages d'éclairage vivent ici : le panneau les modifie, le Viewer3D les reçoit.
  const [lighting, setLighting] = useState(DEFAULT_LIGHTING)

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold text-slate-900">Démonstrateur 3D</h1>
      <p className="text-slate-600">
        Une forme de base ou un fichier OBJ, éclairés et en rotation, dessinés en WebGL2 écrit à la main, sans moteur 3D.
      </p>
      {/* Une colonne sur mobile (le panneau d'éclairage sous celui du maillage), deux côte à côte dès
          l'écran moyen. `items-start` : chaque panneau garde sa hauteur au lieu de s'étirer. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        <MeshPanel mesh={mesh} source={source} error={error} onSelectShape={selectShape} onLoadFile={loadFile} />
        <LightingPanel settings={lighting} onChange={setLighting} />
      </div>
      <Viewer3D
        className="aspect-video w-full rounded-lg"
        mesh={mesh}
        lighting={lighting}
        label={`Objet affiché en 3D, qui tourne lentement : ${name}`}
        onMeshError={reportDisplayError}
      />
    </main>
  )
}
