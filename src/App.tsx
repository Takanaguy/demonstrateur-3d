import { MeshPanel } from './ui/MeshPanel'
import { shapeLabel, useMeshSelection } from './ui/useMeshSelection'
import { Viewer3D } from './viewer/Viewer3D'

export default function App() {
  const { selection, error, selectShape, loadFile, reportDisplayError } = useMeshSelection()
  const { mesh, source } = selection
  const name = source.kind === 'shape' ? shapeLabel(source.shape) : `fichier ${source.fileName}`

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold text-slate-900">Démonstrateur 3D</h1>
      <p className="text-slate-600">
        Une forme de base ou un fichier OBJ, éclairés et en rotation, dessinés en WebGL2 écrit à la main, sans moteur 3D.
      </p>
      <MeshPanel mesh={mesh} source={source} error={error} onSelectShape={selectShape} onLoadFile={loadFile} />
      <Viewer3D
        className="aspect-video w-full rounded-lg"
        mesh={mesh}
        label={`Objet affiché en 3D, qui tourne lentement : ${name}`}
        onMeshError={reportDisplayError}
      />
    </main>
  )
}
