/**
 * Buffers et VAO, sans React.
 *
 * - Un BUFFER est un bloc de mémoire sur le GPU (ici : les positions, les normales ou les
 *   indices du maillage). On y copie les données une fois ; le GPU les relit ensuite à chaque image.
 * - Un VAO (Vertex Array Object) mémorise « quel buffer alimente quelle entrée du shader, avec
 *   quel format ». On le configure une fois, puis on le rebranche en une seule instruction avant
 *   chaque dessin, au lieu de refaire tout le câblage à chaque image.
 */

/** Une entrée du vertex shader (ex. la position) et le buffer de données qui l'alimente. */
export interface VertexAttribute {
  /** Numéro de l'entrée, celui du `layout(location = N)` dans le shader. */
  location: number
  /** Nombre de valeurs par sommet (3 pour un vecteur x, y, z). */
  size: number
  data: Float32Array
}

export interface IndexedMeshData {
  attributes: readonly VertexAttribute[]
  /**
   * Indices des sommets, trois par triangle. 16 bits suffisent jusqu'à 65 535 sommets ; au-delà
   * il faut du 32 bits (voir `createIndexArray` dans core/mesh.ts).
   */
  indices: Uint16Array | Uint32Array
}

export interface IndexedMesh {
  vao: WebGLVertexArrayObject
  indexCount: number
  /** Dessine tous les triangles. Le programme et les uniforms doivent déjà être en place. */
  draw: () => void
  /** Supprime le VAO et tous ses buffers. */
  dispose: () => void
}

/** Crée un buffer et y copie `data`. Il reste branché sur `target` à la sortie. */
export function createBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: AllowSharedBufferSource,
  usage: number = gl.STATIC_DRAW,
): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('Impossible de créer un buffer WebGL (contexte WebGL perdu ?).')
  gl.bindBuffer(target, buffer) // « le buffer courant pour ce rôle, c'est celui-ci »
  // STATIC_DRAW : indice donné au pilote, les données sont écrites une fois et lues souvent.
  gl.bufferData(target, data, usage)
  return buffer
}

export function createVertexArray(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  if (!vao) throw new Error('Impossible de créer un VAO WebGL (contexte WebGL perdu ?).')
  return vao
}

/**
 * Construit un VAO prêt à dessiner : un buffer par attribut, plus un buffer d'indices.
 * Si une étape échoue (fabrique qui renvoie `null`, ou erreur WebGL lue avec `getError` comme le
 * manque de mémoire GPU), tout ce qui a été créé jusque-là est supprimé avant de relancer l'erreur.
 */
export function createIndexedMesh(gl: WebGL2RenderingContext, mesh: IndexedMeshData): IndexedMesh {
  validate(mesh)

  // `getError` rend UNE erreur à la fois puis la remet à zéro. On vide donc d'abord celles qui
  // traînent (d'un dessin ou d'un autre maillage), pour ne pas accuser ce maillage-ci à tort.
  drainGlErrors(gl)

  const vao = createVertexArray(gl)
  const buffers: WebGLBuffer[] = []
  const dispose = () => {
    for (const buffer of buffers) gl.deleteBuffer(buffer)
    gl.deleteVertexArray(vao)
  }

  try {
    // Tant que ce VAO est actif, les réglages ci-dessous sont enregistrés DANS le VAO.
    gl.bindVertexArray(vao)

    for (const { location, size, data } of mesh.attributes) {
      buffers.push(createBuffer(gl, gl.ARRAY_BUFFER, data))
      gl.enableVertexAttribArray(location) // l'entrée du shader lira dans un buffer
      // Comment lire ce buffer : `size` flottants par sommet, sans normalisation, serrés les uns
      // contre les autres (pas = 0), en partant du début (décalage = 0).
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    }

    // Le buffer d'indices doit être créé pendant que le VAO est actif : c'est le VAO qui le retient.
    buffers.push(createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices))

    // Lu AVANT de débrancher le VAO et APRÈS toutes les copies : un `bufferData` qui manque de
    // mémoire GPU ne lève aucune exception, il pose seulement un drapeau d'erreur. Lever ici
    // déclenche le `catch` (qui libère ce maillage à moitié créé) et laisse l'appelant garder l'ancien.
    throwIfGlError(gl)

    // On débranche le VAO avant tout autre réglage, pour ne pas modifier le sien par erreur.
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  } catch (error) {
    dispose()
    throw error
  }

  // drawElements doit savoir comment relire le buffer d'indices : si le type ne correspond pas au
  // tableau envoyé, le GPU lirait des indices faux. WebGL2 accepte les indices 32 bits sans
  // extension, contrairement à WebGL1.
  const indexType = mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT

  return {
    vao,
    indexCount: mesh.indices.length,
    draw: () => {
      gl.bindVertexArray(vao)
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, indexType, 0)
      gl.bindVertexArray(null)
    },
    dispose,
  }
}

/** Nombre maximal de lectures de `getError` en une fois : évite une boucle sans fin si un contexte défaillant répond toujours une erreur. */
const MAX_ERROR_READS = 32

/**
 * Lit et efface les erreurs WebGL en attente. Exportée avec `throwIfGlError` pour que les séries de
 * lignes (lineRenderer.ts) détectent un manque de mémoire GPU de la même façon, sans copier la logique.
 */
export function drainGlErrors(gl: WebGL2RenderingContext): void {
  for (let i = 0; i < MAX_ERROR_READS && gl.getError() !== gl.NO_ERROR; i++) {
    // Rien à faire : lire suffit à effacer le drapeau.
  }
}

/** Lève une erreur claire si WebGL a signalé un échec depuis le dernier vidage. */
export function throwIfGlError(gl: WebGL2RenderingContext): void {
  const code = gl.getError()
  if (code === gl.NO_ERROR) return
  if (code === gl.OUT_OF_MEMORY) {
    throw new Error('Mémoire graphique insuffisante pour ce modèle (WebGL : OUT_OF_MEMORY).')
  }
  throw new Error(`Erreur WebGL pendant l'envoi du modèle au GPU (code ${code}).`)
}

/**
 * Vérifie la cohérence des données avant d'appeler le GPU : une erreur ici dit précisément ce
 * qui ne va pas, alors que WebGL ne dirait rien (le dessin serait simplement faux ou vide).
 * Lève une `RangeError` sinon.
 */
function validate({ attributes, indices }: IndexedMeshData): void {
  if (attributes.length === 0) throw new RangeError('Un maillage a besoin d\'au moins un attribut.')
  let vertexCount = -1
  for (const { location, size, data } of attributes) {
    if (!Number.isInteger(size) || size < 1 || size > 4) {
      throw new RangeError(`Attribut ${location} : taille ${size} invalide (attendu : 1 à 4 valeurs par sommet).`)
    }
    if (data.length % size !== 0) {
      throw new RangeError(`Attribut ${location} : ${data.length} valeurs ne se divisent pas en sommets de ${size}.`)
    }
    const count = data.length / size
    if (vertexCount !== -1 && count !== vertexCount) {
      throw new RangeError(`Les attributs n'ont pas le même nombre de sommets (${vertexCount} et ${count}).`)
    }
    vertexCount = count
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new RangeError(`Les indices (${indices.length}) doivent former des triangles (multiple de 3, non vide).`)
  }
  for (const index of indices) {
    if (index >= vertexCount) {
      throw new RangeError(`Indice ${index} hors limites : il n'y a que ${vertexCount} sommets.`)
    }
  }
}
