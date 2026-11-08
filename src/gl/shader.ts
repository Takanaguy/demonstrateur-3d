/**
 * Compilation et liaison des shaders, sans React.
 *
 * Un shader est un petit programme (écrit en GLSL) qui s'exécute sur le GPU. Il faut le
 * COMPILER, puis LIER un shader de sommets et un shader de fragments en un « programme » que le
 * GPU peut utiliser. WebGL ne lève aucune exception quand cela échoue : il faut interroger le
 * statut soi-même et lire le journal (« info log ») du compilateur, qui dit où est l'erreur.
 */

/** Nom lisible du type de shader, pour les messages d'erreur. */
function shaderLabel(gl: WebGL2RenderingContext, type: number): string {
  return type === gl.VERTEX_SHADER ? 'de sommets (vertex)' : 'de fragments (fragment)'
}

/**
 * Compile un shader. En cas d'échec, libère le shader et lève une erreur qui contient le journal
 * du compilateur (numéro de ligne et nature du problème).
 */
export function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const label = shaderLabel(gl, type)
  const shader = gl.createShader(type)
  // `null` arrive notamment quand le contexte a été perdu.
  if (!shader) throw new Error(`Impossible de créer le shader ${label} (contexte WebGL perdu ?).`)

  gl.shaderSource(shader, source) // envoie le texte GLSL au pilote
  gl.compileShader(shader) // le pilote le compile pour le GPU

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(aucun détail fourni par le pilote)'
    // Sans ce delete, le shader raté resterait en mémoire GPU : personne n'a sa référence.
    gl.deleteShader(shader)
    throw new Error(`La compilation du shader ${label} a échoué :\n${log}`)
  }
  return shader
}

/**
 * Compile les deux shaders puis les lie en un programme. En cas d'échec à n'importe quelle étape,
 * tout ce qui a déjà été créé est libéré avant de lever l'erreur (avec le journal du pilote).
 *
 * Une fois la liaison réussie, on demande la suppression des deux shaders : le programme garde sa
 * propre copie du code compilé, et les shaders encore attachés ne sont réellement libérés par le
 * pilote qu'au `deleteProgram`. Il n'y a donc rien d'autre à supprimer plus tard que le programme.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  let fragmentShader: WebGLShader
  try {
    fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  } catch (error) {
    gl.deleteShader(vertexShader)
    throw error
  }

  const releaseShaders = () => {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
  }

  const program = gl.createProgram()
  if (!program) {
    releaseShaders()
    throw new Error('Impossible de créer le programme WebGL (contexte WebGL perdu ?).')
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program) // vérifie que les sorties du vertex shader correspondent aux entrées du fragment shader

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(aucun détail fourni par le pilote)'
    gl.deleteProgram(program)
    releaseShaders()
    throw new Error(`La liaison du programme WebGL a échoué :\n${log}`)
  }

  releaseShaders()
  return program
}
