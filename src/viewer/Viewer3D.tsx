import { useEffect, useRef, useState } from 'react'
import { WebGLRenderer } from 'three'
import { advanceRotation } from '../core/rotation'
import { isWebGLAvailable } from '../core/webgl'
import { createCubeScene } from './cubeScene'

/** Tours par seconde : un tour complet en dix secondes, une rotation lente et pas distrayante. */
const ROTATION_TURNS_PER_SECOND = 0.1

interface Viewer3DProps {
  /** Le composant remplit son parent : c'est le parent qui fixe la taille. */
  className?: string
}

/**
 * Possède un `<canvas>` et y affiche la scène 3D.
 *
 * Le cycle de vie du renderer est entièrement dans le `useEffect` : tout ce qu'il crée, il le
 * détruit dans sa fonction de nettoyage. C'est indispensable en StrictMode, où React monte,
 * démonte puis remonte le composant en développement : sans nettoyage, on cumulerait des
 * renderers et des boucles d'animation.
 */
export function Viewer3D({ className = '' }: Viewer3DProps) {
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
      // Un seul rendu supplémentaire, dans un cas d'erreur rare : la règle contre le setState
      // dans un effet vise les boucles de rendu, qui sont impossibles ici (on sort juste après).
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
