import { Viewer3D } from './viewer/Viewer3D'

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold text-slate-900">Démonstrateur 3D</h1>
      <p className="text-slate-600">Étape 1 : un cube qui tourne, pour vérifier que Three.js fonctionne.</p>
      <Viewer3D className="aspect-video w-full rounded-lg" />
    </main>
  )
}
