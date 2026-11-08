import { useEffect, useRef, useState } from 'react'
import { advanceRotation } from '../core/rotation'
import { isWebGLAvailable } from '../core/webgl'
import { createCubeRenderer, type CubeRenderer } from '../gl/cubeRenderer'

/** Tours par seconde : un tour complet en dix secondes, une rotation lente et pas distrayante. */
const ROTATION_TURNS_PER_SECOND = 0.1

/**
 * Taille par défaut : le canvas remplit son parent. Sans taille CSS, un canvas prend celle de ses
 * attributs `width` et `height`, que ce composant réécrit à chaque redimensionnement (taille CSS
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
 * Crée le renderer, ou renvoie `null` (en journalisant la cause) si le GPU ou les shaders le
 * refusent. Le message du compilateur arrive ainsi dans la console, utile pour comprendre.
 */
function tryCreateRenderer(gl: WebGL2RenderingContext): CubeRenderer | null {
  try {
    return createCubeRenderer(gl)
  } catch (error) {
    console.error('Démonstrateur 3D : création du rendu impossible.', error)
    return null
  }
}

/**
 * Possède un `<canvas>` et y dessine le cube en WebGL2.
 *
 * Contrat de taille : le parent doit avoir une taille, le canvas la remplit (`block h-full w-full`
 * par défaut). La mise en page décide de la taille affichée ; le composant adapte ensuite la
 * résolution du canvas (en pixels réels), le viewport et la projection.
 *
 * Le cycle de vie est entièrement dans le `useEffect` : tout ce qu'il crée, il le détruit dans sa
 * fonction de nettoyage. C'est indispensable en StrictMode, où React monte, démonte puis remonte
 * le composant en développement : sans nettoyage, on cumulerait des ressources GPU et des boucles
 * d'animation.
 */
export function Viewer3D({ className = DEFAULT_SIZE_CLASSES }: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Initialiseur paresseux : la détection ne tourne qu'au premier rendu, pas à chacun.
  const [webglAvailable] = useState(() => isWebGLAvailable())
  // WebGL peut être annoncé disponible et échouer quand même (contexte refusé, shaders refusés).
  const [renderFailed, setRenderFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!webglAvailable || !canvas) return

    // `antialias` : lissage des bords (dentelures) fait par le GPU, si le navigateur le permet.
    const gl = canvas.getContext('webgl2', { antialias: true })
    let renderer = gl ? tryCreateRenderer(gl) : null
    if (!gl || !renderer) {
      // On ne sait si le contexte et les shaders sont acceptés qu'en les essayant : le rendu de
      // repli est donc déclenché ici, une seule fois, dans ce cas d'échec rare.
      setRenderFailed(true)
      return
    }

    // On lit `matches` à chaque image plutôt qu'une fois au montage : la requête reste à jour
    // si l'utilisateur change le réglage système pendant que la page est ouverte.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')

    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      // Résolution réelle du canvas = taille affichée x ratio de pixels de l'écran (plafonné à 2
      // pour ne pas dessiner inutilement quatre fois plus de pixels sur un écran très dense).
      // N'écrire que si ça change : modifier width/height efface le canvas, même à valeur égale.
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const bufferWidth = Math.max(1, Math.round(width * ratio))
      const bufferHeight = Math.max(1, Math.round(height * ratio))
      if (canvas.width !== bufferWidth) canvas.width = bufferWidth
      if (canvas.height !== bufferHeight) canvas.height = bufferHeight
      // On prend la taille réellement obtenue (le navigateur peut limiter un très grand canvas).
      renderer?.setViewport(gl.drawingBufferWidth, gl.drawingBufferHeight)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)

    let angle = 0
    let frameId = 0
    let lastTime: number | null = null
    const animate = (time: number) => {
      if (lastTime !== null && !reducedMotion?.matches) {
        const radiansPerSecond = ROTATION_TURNS_PER_SECOND * Math.PI * 2
        angle = advanceRotation(angle, (time - lastTime) / 1000, radiansPerSecond)
      }
      lastTime = time
      renderer?.draw(angle)
      frameId = requestAnimationFrame(animate)
    }
    const startLoop = () => {
      lastTime = null // évite un grand saut de rotation après une pause (contexte perdu)
      frameId = requestAnimationFrame(animate)
    }
    const stopLoop = () => cancelAnimationFrame(frameId)
    startLoop()

    // Perte du contexte WebGL : le navigateur ou le pilote peut reprendre le GPU (veille, trop de
    // contextes ouverts, plantage du pilote). Toutes les ressources GPU disparaissent alors.
    const onContextLost = (event: Event) => {
      // Sans preventDefault, le navigateur considère la perte comme définitive et ne tentera
      // jamais de restaurer le contexte.
      event.preventDefault()
      stopLoop()
      // Les ressources sont déjà détruites côté GPU : inutile (et sans effet) de les supprimer.
      renderer = null
    }
    const onContextRestored = () => {
      // Le contexte est de retour mais vide : on recrée programme, buffers et VAO, puis on repart.
      renderer = tryCreateRenderer(gl)
      if (!renderer) {
        setRenderFailed(true)
        return
      }
      resize()
      startLoop()
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    return () => {
      stopLoop()
      resizeObserver.disconnect()
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      // Supprime programme, buffers et VAO. Volontairement pas de `loseContext()` : en StrictMode
      // le canvas est réutilisé par le second montage, et un contexte volontairement perdu ne
      // peut pas être récupéré.
      renderer?.dispose()
      renderer = null
    }
  }, [webglAvailable])

  if (!webglAvailable || renderFailed) {
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
