import { useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_CAMERA, orbitCamera, zoomCamera, type OrbitCamera } from '../core/camera'
import { DEFAULT_LIGHTING, type LightingSettings } from '../core/lighting'
import type { Mesh } from '../core/mesh'
import { advanceRotation } from '../core/rotation'
import { createShape } from '../core/shapes'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
import { isWebGLAvailable } from '../core/webgl'
import { createMeshRenderer, type MeshRenderer } from '../gl/meshRenderer'

/** Tours par seconde : un tour complet en dix secondes, une rotation lente et pas distrayante. */
const ROTATION_TURNS_PER_SECOND = 0.1

/**
 * Glisser sur toute la largeur du canvas fait un tour complet (2 PI radians). Le même nombre de
 * radians par pixel sert à la verticale : un geste en diagonale tourne autant dans les deux sens.
 */
const RADIANS_PER_CANVAS_WIDTH = 2 * Math.PI
/** Une pression sur une flèche tourne la caméra de 0,1 rad (environ 5,7 degrés) ; maintenir la touche répète. */
const KEY_ROTATION_STEP = 0.1
/** Une pression sur + rapproche la caméra de 10 % (distance divisée par ce facteur), - l'éloigne de 10 %. */
const KEY_ZOOM_FACTOR = 1.1
/**
 * Zoom à la molette : la distance est multipliée par exp(deltaY * vitesse). Un cran classique
 * (deltaY = 100) donne un facteur 1,105, soit environ 10 % comme au clavier. L'exponentielle rend le
 * geste symétrique : un cran vers le haut annule exactement un cran vers le bas.
 */
const WHEEL_ZOOM_SPEED = 0.001
/** Firefox peut compter la molette en lignes (deltaMode 1) et non en pixels : une ligne vaut environ 16 pixels. */
const WHEEL_LINE_PIXELS = 16
/** Une molette comptée en pages (deltaMode 2, rare) : une page vaut 100 pixels, soit un cran classique. */
const WHEEL_PAGE_PIXELS = 100

/** Lu par les lecteurs d'écran quand le canvas a le focus (voir `aria-describedby`). */
const CONTROLS_HELP =
  "Glisser pour tourner autour de l'objet, molette pour zoomer. Au clavier : flèches pour tourner, plus et moins pour zoomer."

/**
 * Taille par défaut : le canvas remplit son parent. Sans taille CSS, un canvas prend celle de ses
 * attributs `width` et `height`, que ce composant réécrit à chaque redimensionnement (taille CSS
 * multipliée par le ratio de pixels) : sur un écran dense, le canvas grossirait alors sans fin.
 */
const DEFAULT_SIZE_CLASSES = 'h-full w-full'

/**
 * Maillage affiché quand l'appelant n'en donne pas. Créé UNE fois, hors du composant : une valeur
 * par défaut recréée à chaque rendu serait un « nouveau » maillage à chaque fois et relancerait
 * l'envoi au GPU.
 */
const DEFAULT_MESH = createShape('cube')

interface Viewer3DProps {
  /**
   * Classes Tailwind qui dimensionnent le composant. Elles REMPLACENT la taille par défaut
   * (`h-full w-full`) au lieu de s'y ajouter, pour que deux classes contradictoires ne se
   * disputent jamais : l'appelant qui en passe doit donc fixer lui-même une taille.
   */
  className?: string
  /** Maillage à afficher. Quand il change, il remplace l'ancien sans recréer le canvas ni le contexte WebGL. */
  mesh?: Mesh
  /** Réglages de l'éclairage. Quand ils changent, ils sont envoyés au GPU sans recréer le contexte WebGL. */
  lighting?: LightingSettings
  /** Options de vue (rotation automatique, culling). Quand elles changent, elles sont appliquées sans recréer le contexte WebGL. */
  viewOptions?: ViewOptions
  /**
   * Quand cette valeur change, la caméra revient à sa position de départ. La valeur elle-même n'a pas
   * de sens (l'appelant incrémente un compteur) ; au premier rendu, la caméra est déjà à sa place.
   */
  resetViewKey?: number
  /** Description de ce qui est affiché, lue par les lecteurs d'écran (le canvas n'a pas de texte). */
  label?: string
  /**
   * Appelé si le nouveau maillage n'a pas pu être envoyé au GPU. L'ancien reste alors affiché : à
   * l'appelant de revenir à l'ancien choix pour que l'interface reste cohérente avec l'écran.
   */
  onMeshError?: (error: unknown) => void
}

/**
 * Crée le renderer, ou renvoie `null` (en journalisant la cause) si le GPU ou les shaders le
 * refusent. Le message du compilateur arrive ainsi dans la console, utile pour comprendre.
 */
function tryCreateRenderer(
  gl: WebGL2RenderingContext,
  mesh: Mesh,
  lighting: LightingSettings,
  camera: OrbitCamera,
  viewOptions: ViewOptions,
): MeshRenderer | null {
  try {
    return createMeshRenderer(gl, mesh, lighting, camera, viewOptions)
  } catch (error) {
    console.error('Démonstrateur 3D : création du rendu impossible.', error)
    return null
  }
}

/**
 * Possède un `<canvas>` et y dessine un maillage éclairé en WebGL2, que l'on peut regarder sous tous
 * les angles (souris, doigt ou clavier).
 *
 * Contrat de taille : le parent doit avoir une taille, le canvas la remplit (`block h-full w-full`
 * par défaut). La mise en page décide de la taille affichée ; le composant adapte ensuite la
 * résolution du canvas (en pixels réels), le viewport et la projection.
 *
 * Le cycle de vie est entièrement dans le `useEffect` : tout ce qu'il crée, il le détruit dans sa
 * fonction de nettoyage. C'est indispensable en StrictMode, où React monte, démonte puis remonte
 * le composant en développement : sans nettoyage, on cumulerait des ressources GPU et des boucles
 * d'animation.
 *
 * Le contexte WebGL et le renderer sont créés une seule fois ; changer la prop `mesh` ne fait
 * qu'appeler `setMesh` (voir le second effet). Il en va de même pour les props `lighting` et `viewOptions`.
 *
 * La caméra, elle, n'est PAS une prop ni un état React : elle vit dans une référence, modifiée
 * directement par les gestionnaires d'événements (souris, doigt, clavier, molette) et relue par la
 * boucle de dessin à chaque image. Un état React changerait à chaque mouvement de souris et ferait
 * refaire le rendu du composant (et de ses parents) des dizaines de fois par seconde pour rien.
 */
export function Viewer3D({
  className = DEFAULT_SIZE_CLASSES,
  mesh = DEFAULT_MESH,
  lighting = DEFAULT_LIGHTING,
  viewOptions = DEFAULT_VIEW_OPTIONS,
  resetViewKey = 0,
  label = 'Un objet en 3D',
  onMeshError,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Le maillage actuellement affiché. Le renderer est recréé après une perte de contexte : c'est
  // cette référence qui lui dit quoi redessiner (le DERNIER maillage choisi, pas le premier).
  const meshRef = useRef(mesh)
  // Les derniers réglages d'éclairage, pour la même raison : le renderer recréé après une perte de
  // contexte repart des réglages par défaut du GPU, il faut lui redonner les DERNIERS.
  const lightingRef = useRef(lighting)
  // La caméra COURANTE (voir plus haut pourquoi une référence). Après une perte de contexte, le
  // renderer recréé reçoit celle-ci : l'utilisateur ne perd pas son point de vue.
  const cameraRef = useRef<OrbitCamera>(DEFAULT_CAMERA)
  // Les dernières options de vue : relues à chaque image (rotation automatique) et redonnées au
  // renderer recréé après une perte de contexte (le culling repart désactivé).
  const viewOptionsRef = useRef(viewOptions)
  // La dernière valeur de `resetViewKey` vue, pour détecter un changement.
  const resetViewKeyRef = useRef(resetViewKey)
  // Identifiant du texte d'aide des commandes, relié au canvas par `aria-describedby`.
  const helpId = useId()
  // Le renderer vivant, partagé entre l'effet principal (qui le crée) et l'effet du maillage.
  const rendererRef = useRef<MeshRenderer | null>(null)
  // Initialiseur paresseux : la détection ne tourne qu'au premier rendu, pas à chacun.
  const [webglAvailable] = useState(() => isWebGLAvailable())
  // WebGL peut être annoncé disponible et échouer quand même (contexte refusé, shaders refusés).
  const [renderFailed, setRenderFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!webglAvailable || !canvas) return

    // `antialias` : lissage des bords (dentelures) fait par le GPU, si le navigateur le permet.
    const gl = canvas.getContext('webgl2', { antialias: true })
    let renderer = gl
      ? tryCreateRenderer(gl, meshRef.current, lightingRef.current, cameraRef.current, viewOptionsRef.current)
      : null
    if (!gl || !renderer) {
      // On ne sait si le contexte et les shaders sont acceptés qu'en les essayant : le rendu de
      // repli est donc déclenché ici, une seule fois, dans ce cas d'échec rare.
      setRenderFailed(true)
      return
    }

    rendererRef.current = renderer

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
      // La rotation automatique s'arrête si l'utilisateur la désactive OU demande moins de mouvement.
      if (lastTime !== null && viewOptionsRef.current.autoRotate && !reducedMotion?.matches) {
        const radiansPerSecond = ROTATION_TURNS_PER_SECOND * Math.PI * 2
        angle = advanceRotation(angle, (time - lastTime) / 1000, radiansPerSecond)
      }
      lastTime = time
      // La caméra est relue à chaque image : c'est ce qui rend la souris fluide sans passer par React.
      renderer?.setCamera(cameraRef.current)
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
      rendererRef.current = null
    }
    const onContextRestored = () => {
      // Le contexte est de retour mais vide : on recrée programme, buffers et VAO, puis on repart.
      renderer = tryCreateRenderer(gl, meshRef.current, lightingRef.current, cameraRef.current, viewOptionsRef.current)
      rendererRef.current = renderer
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
      rendererRef.current = null
    }
  }, [webglAvailable])

  // Changement de maillage : on garde le contexte, le canvas et la boucle, on remplace seulement
  // les données GPU. Ne rien faire quand le maillage est déjà celui affiché évite de le renvoyer
  // au GPU au premier rendu (le renderer vient de le recevoir) et au second montage de StrictMode.
  useEffect(() => {
    if (meshRef.current === mesh) return
    const renderer = rendererRef.current
    if (renderer) {
      try {
        renderer.setMesh(mesh)
      } catch (error) {
        // L'ancien maillage est resté affiché (voir setMesh) : meshRef n'est donc pas modifié.
        console.error('Démonstrateur 3D : envoi du maillage au GPU impossible.', error)
        onMeshError?.(error)
        return
      }
    }
    // Pas de renderer (contexte perdu en ce moment) : on retient quand même le choix, la restauration l'utilisera.
    meshRef.current = mesh
  }, [mesh, onMeshError])

  // Changement d'éclairage : même logique que pour le maillage, on garde contexte, canvas et boucle et on
  // renvoie seulement les uniforms. Rien à faire au premier rendu (le renderer vient de les recevoir).
  useEffect(() => {
    if (lightingRef.current === lighting) return
    // On retient TOUJOURS les réglages, même sans renderer (contexte perdu en ce moment) : la
    // restauration les réappliquera. `setLighting` ne lève pas d'erreur (les réglages sont assainis).
    lightingRef.current = lighting
    rendererRef.current?.setLighting(lighting)
  }, [lighting])

  // Options de vue : même logique que l'éclairage. On retient TOUJOURS les dernières (même sans
  // renderer, contexte perdu en ce moment) : la restauration les réappliquera.
  useEffect(() => {
    if (viewOptionsRef.current === viewOptions) return
    viewOptionsRef.current = viewOptions
    rendererRef.current?.setViewOptions(viewOptions)
  }, [viewOptions])

  // Réinitialisation de la caméra : quand la clé change, on remet la caméra de départ. La boucle de
  // dessin la relit à la prochaine image. Au premier rendu la clé est déjà celle de la référence.
  useEffect(() => {
    if (resetViewKeyRef.current === resetViewKey) return
    resetViewKeyRef.current = resetViewKey
    cameraRef.current = DEFAULT_CAMERA
  }, [resetViewKey])

  // Commandes de la caméra : souris, doigt, molette et clavier. Dans un effet à part car elles n'ont
  // pas besoin du renderer, seulement du canvas : elles modifient `cameraRef`, que la boucle relit.
  // `webglAvailable` et `renderFailed` décident si le canvas existe : quand il disparaît (échec de
  // la restauration du contexte), l'effet est nettoyé puis ne fait rien.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Le glisser en cours : quel doigt ou quelle souris (`pointerId`), et sa dernière position. `null`
    // quand rien n'est glissé. Un seul pointeur à la fois : un deuxième doigt est ignoré (pas de pincement).
    let drag: { pointerId: number; x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent) => {
      // Seulement le bouton principal (clic gauche, doigt, stylet) et un seul glisser à la fois.
      if (drag || event.button !== 0) return
      // La capture envoie tous les événements suivants de ce pointeur au canvas, même s'il sort du
      // canvas pendant le glisser. Sans elle, relâcher hors du canvas laisserait le glisser « collé ».
      canvas.setPointerCapture(event.pointerId)
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      // Aucun bouton enfoncé alors qu'un glisser est en cours : le relâchement a été manqué (bouton
      // lâché hors de la fenêtre ou de l'onglet, sans capture accordée...). On abandonne le glisser
      // au lieu de continuer à tourner la caméra sans rien tenir. Pour un doigt ou un stylet en
      // contact, `buttons` vaut 1 : seule la souris peut tomber dans ce cas.
      if (event.buttons === 0) {
        drag = null
        return
      }
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      drag.x = event.clientX
      drag.y = event.clientY
      const width = canvas.clientWidth
      if (width === 0) return // canvas sans taille : pas de conversion pixels vers radians possible
      const radiansPerPixel = RADIANS_PER_CANVAS_WIDTH / width
      // Signes : glisser vers la droite fait tourner l'objet vers la droite, donc la caméra va vers la
      // gauche (azimut qui diminue). Glisser vers le bas (y de l'écran croissant) fait basculer le
      // dessus de l'objet vers nous, donc la caméra monte (élévation qui augmente).
      cameraRef.current = orbitCamera(cameraRef.current, -dx * radiansPerPixel, dy * radiansPerPixel)
    }
    // Relâchement (`pointerup`), interruption par le système (`pointercancel` : appel entrant, geste
    // système...) ou capture du pointeur perdue (`lostpointercapture` : le navigateur ou la page
    // l'a reprise, par exemple si le canvas est retiré ou masqué en plein glisser) : dans les trois
    // cas le glisser est fini.
    const onPointerEnd = (event: PointerEvent) => {
      if (drag && event.pointerId === drag.pointerId) drag = null
    }

    const onWheel = (event: WheelEvent) => {
      // Sans preventDefault, la page défilerait en même temps que le zoom. Il n'a d'effet que parce
      // que l'écouteur est ajouté avec `passive: false` (voir plus bas).
      event.preventDefault()
      // deltaY peut être compté en pixels (le plus courant), en lignes ou en pages : on convertit tout en pixels.
      let pixels = event.deltaY
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) pixels *= WHEEL_LINE_PIXELS
      else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) pixels *= WHEEL_PAGE_PIXELS
      cameraRef.current = zoomCamera(cameraRef.current, Math.exp(pixels * WHEEL_ZOOM_SPEED))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl, Cmd ou Alt avec + ou - sont les raccourcis de zoom du navigateur : on ne les vole pas.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const camera = cameraRef.current
      // Une flèche a le même effet qu'un glisser dans sa direction (voir `onPointerMove`).
      switch (event.key) {
        case 'ArrowLeft':
          cameraRef.current = orbitCamera(camera, KEY_ROTATION_STEP, 0)
          break
        case 'ArrowRight':
          cameraRef.current = orbitCamera(camera, -KEY_ROTATION_STEP, 0)
          break
        case 'ArrowUp':
          cameraRef.current = orbitCamera(camera, 0, -KEY_ROTATION_STEP)
          break
        case 'ArrowDown':
          cameraRef.current = orbitCamera(camera, 0, KEY_ROTATION_STEP)
          break
        case '+':
        case '=': // sur un clavier QWERTY, + demande la touche Maj : on accepte aussi la touche seule
          cameraRef.current = zoomCamera(camera, 1 / KEY_ZOOM_FACTOR)
          break
        case '-':
          cameraRef.current = zoomCamera(camera, KEY_ZOOM_FACTOR)
          break
        default:
          return // une autre touche (Tab, par exemple) garde son rôle habituel
      }
      event.preventDefault() // les flèches feraient sinon défiler la page
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerEnd)
    canvas.addEventListener('pointercancel', onPointerEnd)
    canvas.addEventListener('lostpointercapture', onPointerEnd)
    // React rend ses `onWheel` passifs : preventDefault y serait ignoré. Il faut un vrai écouteur non passif.
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('keydown', onKeyDown)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerEnd)
      canvas.removeEventListener('pointercancel', onPointerEnd)
      canvas.removeEventListener('lostpointercapture', onPointerEnd)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
    }
  }, [webglAvailable, renderFailed])

  if (!webglAvailable || renderFailed) {
    return (
      <div role="status" className={`flex items-center justify-center bg-stone-100 p-6 text-center text-stone-700 ${className}`}>
        La 3D n'est pas disponible sur ce navigateur ou cet appareil (WebGL est désactivé ou non pris en
        charge). Essayez un autre navigateur ou activez l'accélération matérielle.
      </div>
    )
  }

  return (
    <>
      {/* Rôle « application » et non « img » : un canvas qu'on manipule n'est plus une image. Ce rôle
          dit aux lecteurs d'écran de laisser passer les flèches, + et - au composant au lieu de les
          garder pour leur propre navigation (sinon le canvas ne les recevrait jamais). Il est à
          réserver à ce genre de composant à clavier propre, d'où l'aide reliée par aria-describedby.
          `touch-none` (touch-action: none) : sans lui, glisser un doigt sur le canvas ferait défiler
          la page au lieu de tourner la caméra ; en contrepartie, sur mobile, on ne peut plus faire
          défiler la page en touchant le canvas. `select-none` : un glisser ou un double-clic ne doit
          pas sélectionner (surligner) le canvas et le texte voisin. */}
      <canvas
        ref={canvasRef}
        role="application"
        aria-label={label}
        aria-describedby={helpId}
        tabIndex={0}
        className={`block touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${className}`}
      />
      <p id={helpId} className="sr-only">
        {CONTROLS_HELP}
      </p>
    </>
  )
}
