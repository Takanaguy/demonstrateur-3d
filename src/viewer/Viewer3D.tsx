import { useEffect, useRef, useState } from 'react'
import { WebGLRenderer } from 'three'
import { advanceRotation } from '../core/rotation'
import { isWebGLAvailable } from '../core/webgl'
import { createCubeScene } from './cubeScene'

/** Tours par seconde : un tour complet en dix secondes, une rotation lente et pas distrayante. */
const ROTATION_TURNS_PER_SECOND = 0.1

/**
 * Taille par défaut : le canvas remplit son parent. Sans taille CSS, un canvas prend celle de ses
 * attributs `width` et `height`, que Three.js réécrit à chaque redimensionnement (taille CSS
 * multipliée par le ratio de pixels) : sur un écran dense, le canvas grossirait alors sans fin.
 */
const DEFAULT_SIZE_CLASSES = 'h-full w-full'

interface Viewer3DProps {
  /**
   * Classes Tailwind qui dimensionnent le composant. Elles REMPLACENT la taille par défaut
   * (`h-full w-full`) au lieu de s'y ajouter, pour que deux classes contradictoires ne se
   * disputent jamais : l'appelant qui en passe doit donc fixer lui-même une taille.
   */
  className?: string
}

/**
 * Possède un `<canvas>` et y affiche la scène 3D.
 *
 * Contrat de taille : le parent doit avoir une taille, le canvas la remplit (`block h-full w-full`
 * par défaut). Three.js ne touche jamais au style CSS du canvas : c'est la mise en page qui
 * décide de la taille affichée, et le composant adapte ensuite la résolution et la caméra.
 *
 * Le cycle de vie du renderer est entièrement dans le `useEffect` : tout ce qu'il crée, il le
 * détruit dans sa fonction de nettoyage. C'est indispensable en StrictMode, où React monte,
 * démonte puis remonte le composant en développement : sans nettoyage, on cumulerait des
 * renderers et des boucles d'animation.
 */
export function Viewer3D({ className = DEFAULT_SIZE_CLASSES }: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Initialiseur paresseux : la détection ne tourne qu'au premier rendu, pas à chacun.
  const [webglAvailable] = useState(() => isWebGLAvailable())
  // WebGL peut être annoncé disponible et échouer quand même à la création du renderer.
  const [rendererFailed, setRendererFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!webglAvailable || !canvas) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true })
    } catch {
      // La règle `react-hooks/set-state-in-effect` signale tout setState appelé directement dans
      // un effet, car il déclenche un rendu supplémentaire (risque de rendus en cascade). Ici c'est
      // voulu : on ne sait si le renderer s'initialise qu'en l'essayant, et le rendu en plus
      // n'arrive qu'une fois, dans ce cas d'échec rare (l'effet s'arrête juste après).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRendererFailed(true)
      return
    }

    const { scene, camera, cube, dispose: disposeScene } = createCubeScene()

    // On lit `matches` à chaque image plutôt qu'une fois au montage : la requête reste à jour
    // si l'utilisateur change le réglage système pendant que la page est ouverte.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')

    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      // `false` : Three.js ne touche pas au style CSS du canvas, c'est la mise en page qui le dimensionne.
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)

    let frameId = 0
    let lastTime: number | null = null
    const animate = (time: number) => {
      if (lastTime !== null && !reducedMotion?.matches) {
        const radiansPerSecond = ROTATION_TURNS_PER_SECOND * Math.PI * 2
        cube.rotation.y = advanceRotation(cube.rotation.y, (time - lastTime) / 1000, radiansPerSecond)
      }
      lastTime = time
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      disposeScene()
      // Volontairement pas de `forceContextLoss()` : en StrictMode le canvas est réutilisé par
      // le second montage, et un contexte volontairement perdu ne peut pas être récupéré.
      renderer.dispose()
    }
  }, [webglAvailable])

  if (!webglAvailable || rendererFailed) {
    return (
      <div role="status" className={`flex items-center justify-center bg-stone-100 p-6 text-center text-stone-700 ${className}`}>
        La 3D n'est pas disponible sur ce navigateur ou cet appareil (WebGL est désactivé ou non pris en
        charge). Essayez un autre navigateur ou activez l'accélération matérielle.
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Un cube en 3D qui tourne lentement"
      className={`block ${className}`}
    />
  )
}
