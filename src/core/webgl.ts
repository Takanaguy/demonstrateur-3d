/**
 * Détection de WebGL 2, sans React.
 *
 * On teste AVANT de monter le canvas de dessin : `getContext('webgl2')` renvoie `null` si le
 * navigateur ne fournit pas de contexte WebGL 2 (ancien matériel, accélération désactivée, jsdom
 * dans les tests). Sans ce test préalable, il faudrait deviner l'échec plus tard, au milieu de
 * la création des ressources, au lieu d'afficher tout de suite un message clair.
 */

/** Ce dont la détection a besoin : un moyen de fabriquer un canvas (injectable pour les tests). */
export type CanvasFactory = () => HTMLCanvasElement

const defaultCanvasFactory: CanvasFactory = () => document.createElement('canvas')

export function isWebGLAvailable(createCanvas: CanvasFactory = defaultCanvasFactory): boolean {
  try {
    const canvas = createCanvas()
    // Les shaders sont écrits en GLSL ES 3.00, qui n'existe qu'en WebGL 2 : un simple WebGL 1 ne suffit pas.
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
