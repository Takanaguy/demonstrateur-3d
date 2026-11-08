/**
 * Détection de WebGL, sans React ni Three.js.
 *
 * On teste AVANT de créer le renderer Three.js : `new WebGLRenderer()` lève une exception si le
 * navigateur ne fournit pas de contexte WebGL (ancien matériel, accélération désactivée, jsdom
 * dans les tests). Sans ce test préalable, la page entière planterait au lieu d'afficher un
 * message.
 */

/** Ce dont la détection a besoin : un moyen de fabriquer un canvas (injectable pour les tests). */
export type CanvasFactory = () => HTMLCanvasElement

const defaultCanvasFactory: CanvasFactory = () => document.createElement('canvas')

export function isWebGLAvailable(createCanvas: CanvasFactory = defaultCanvasFactory): boolean {
  try {
    const canvas = createCanvas()
    // Three.js ne gère plus que WebGL 2 depuis la r163 : inutile d'accepter un simple WebGL 1.
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    // Les navigateurs limitent le nombre de contextes WebGL vivants en même temps (une
    // quinzaine). On libère celui du test tout de suite pour ne pas en gaspiller un.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    // Certains navigateurs lèvent une exception au lieu de renvoyer null.
    return false
  }
}
