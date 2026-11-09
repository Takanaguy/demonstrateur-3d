/**
 * Faux contexte WebGL2 pour les tests. jsdom n'a pas de WebGL : on remplace le contexte par un
 * objet qui ENREGISTRE les appels, et qui suit les ressources encore « vivantes » (créées mais pas
 * encore supprimées). Un oubli de `delete*` se voit alors tout de suite : le compte ne retombe pas à 0.
 *
 * Ce faux ne vérifie PAS que le rendu est correct (il n'y a pas de GPU) : il vérifie les appels et
 * leur enchaînement. Le rendu réel se regarde dans un navigateur.
 */

export type ResourceKind = 'shader' | 'program' | 'buffer' | 'vertexArray'

interface FakeResource {
  kind: ResourceKind
  id: number
  /** Pour un shader : son type (VERTEX_SHADER ou FRAGMENT_SHADER). */
  shaderType?: number
  /** Pour un buffer : les données copiées par le dernier `bufferData`. */
  data?: number[]
}

/** Un envoi d'uniform : sa valeur, et le programme qui était actif à ce moment (un uniform appartient à UN programme). */
export interface UniformCall {
  transpose?: boolean
  values: number[]
  /** La ressource « programme » active au moment de l'envoi, ou `undefined` si aucun. */
  program: unknown
  /**
   * Le programme auquel appartient l'emplacement de l'uniform. Un envoi n'est juste que si `program` (actif)
   * et `owner` sont le même : sinon la valeur part dans le mauvais programme (oubli de `useProgram`).
   */
  owner: unknown
}

/** Un dessin (`drawElements` ou `drawArrays`), avec l'état du contexte au moment où il est lancé. */
export interface DrawCall {
  call: 'drawElements' | 'drawArrays'
  /** TRIANGLES ou LINES. */
  mode: number
  /** Nombre d'indices (drawElements) ou de sommets (drawArrays). */
  count: number
  /** Le programme actif : le dessin est fait avec celui-là. */
  program: unknown
  /** Vrai si POLYGON_OFFSET_FILL était activé pendant ce dessin. */
  polygonOffsetFill: boolean
}

/** Un appel à `vertexAttribPointer`, avec le contenu du buffer qui était relié à ARRAY_BUFFER à ce moment. */
export interface AttributeBinding {
  location: number
  size: number
  /** Les données du buffer relié : c'est lui que le GPU lira pour cette entrée du shader. */
  data: number[]
}

export interface FakeGlOptions {
  /** Taille du tampon de dessin (lue dans `drawingBufferWidth` / `Height`). Souvent celle du canvas. */
  size?: { width: number; height: number }
  /** Fait échouer la compilation du shader de ce type. */
  failCompile?: 'vertex' | 'fragment'
  failLink?: boolean
  /** Fait renvoyer `null` à la fabrique de cette ressource (comme un contexte perdu). */
  failCreate?: ResourceKind
  /**
   * Simule un `bufferData` qui échoue : comme sur un vrai GPU, rien n'est levé, l'erreur est seulement
   * posée dans la file lue par `getError`. `call` est le rang (à partir de 1) de l'appel à `bufferData`.
   */
  bufferDataError?: { call: number; code: number }
}

export const SHADER_LOG = "0:7: 'foo' : undeclared identifier"
export const PROGRAM_LOG = 'varying vNormal non fourni par le vertex shader'

// Vraies valeurs des constantes WebGL (utile pour lire les traces).
const CONSTANTS = {
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  COMPILE_STATUS: 35713,
  LINK_STATUS: 35714,
  ARRAY_BUFFER: 34962,
  ELEMENT_ARRAY_BUFFER: 34963,
  STATIC_DRAW: 35044,
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  TRIANGLES: 4,
  LINES: 1,
  DEPTH_TEST: 2929,
  CULL_FACE: 2884,
  POLYGON_OFFSET_FILL: 32823,
  NO_ERROR: 0,
  INVALID_OPERATION: 1282,
  OUT_OF_MEMORY: 1285,
  BACK: 1029,
  CCW: 2305,
  COLOR_BUFFER_BIT: 16384,
  DEPTH_BUFFER_BIT: 256,
}

export function createFakeGl(options: FakeGlOptions = {}) {
  const size = options.size ?? { width: 300, height: 150 }
  const live = new Set<FakeResource>()
  let nextId = 1
  let created = 0

  const make = (kind: ResourceKind, extra: Partial<FakeResource> = {}): FakeResource | null => {
    if (options.failCreate === kind) return null
    const resource: FakeResource = { kind, id: nextId++, ...extra }
    live.add(resource)
    created++
    return resource
  }
  const remove = (resource: unknown) => {
    live.delete(resource as FakeResource)
  }

  const failedShaders = new WeakSet<object>()
  /**
   * Un emplacement par PAIRE (programme, nom), comme un vrai contexte : le même nom d'uniform a un
   * emplacement différent dans chaque programme. Le renderer a deux programmes avec des uniforms de
   * mêmes noms (uView, uProjection...), qu'il faut pouvoir distinguer.
   */
  const uniformLocations = new Map<string, { name: string; program: unknown }>()
  /** Le programme actuellement actif (`useProgram`). */
  let currentProgram: unknown
  /** Toutes les valeurs envoyées, dans l'ordre, par nom d'uniform (tous programmes confondus). */
  const uniformHistory = new Map<string, UniformCall[]>()
  const record = (location: unknown, values: Iterable<number>, transpose?: boolean) => {
    const name = (location as { name: string }).name
    const history = uniformHistory.get(name) ?? []
    history.push({
      transpose,
      values: Array.from(values),
      program: currentProgram,
      owner: (location as { program: unknown }).program,
    })
    uniformHistory.set(name, history)
  }

  /** Vrai quand le contexte est « perdu » (voir `setContextLost`) : `isContextLost` le dit, comme un vrai contexte. */
  let contextLost = false

  /** Les dessins lancés, dans l'ordre, avec l'état au moment du dessin. */
  const drawLog: DrawCall[] = []

  /** Le buffer actuellement relié, par cible (ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER). */
  const boundBuffers = new Map<number, FakeResource | null>()
  const attributeBindings: AttributeBinding[] = []

  /** Erreurs en attente, lues une par une par `getError` (puis effacées), comme dans WebGL. */
  const pendingErrors: number[] = []
  let bufferDataCalls = 0

  /**
   * Réglages d'état du contexte : fonctions activées par `enable`, et face éliminée par `cullFace`.
   * Un vrai contexte les garde jusqu'à ce qu'on les change, et un contexte restauré repart des valeurs
   * par défaut (rien d'activé, BACK) : `loseAllResources` les remet à zéro pour le simuler.
   */
  const enabledCapabilities = new Set<number>()
  let cullFaceMode: number = CONSTANTS.BACK

  const mocks = {
    ...CONSTANTS,
    get drawingBufferWidth() {
      return size.width
    },
    get drawingBufferHeight() {
      return size.height
    },

    createShader: vi.fn((type: number) => {
      const shader = make('shader', { shaderType: type })
      const failing = type === CONSTANTS.VERTEX_SHADER ? 'vertex' : 'fragment'
      if (shader && options.failCompile === failing) failedShaders.add(shader)
      return shader
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn((shader: object) => !failedShaders.has(shader)),
    getShaderInfoLog: vi.fn(() => SHADER_LOG),
    deleteShader: vi.fn(remove),

    createProgram: vi.fn(() => make('program')),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => !options.failLink),
    getProgramInfoLog: vi.fn(() => PROGRAM_LOG),
    deleteProgram: vi.fn(remove),
    useProgram: vi.fn((program: unknown) => {
      currentProgram = program
    }),

    createBuffer: vi.fn(() => make('buffer')),
    bindBuffer: vi.fn((target: number, buffer: unknown) => {
      boundBuffers.set(target, buffer as FakeResource | null)
    }),
    bufferData: vi.fn((target: number, data: ArrayLike<number>) => {
      const bound = boundBuffers.get(target)
      if (bound) bound.data = Array.from(data)
      if (options.bufferDataError?.call === ++bufferDataCalls) pendingErrors.push(options.bufferDataError.code)
    }),
    getError: vi.fn(() => pendingErrors.shift() ?? CONSTANTS.NO_ERROR),
    deleteBuffer: vi.fn(remove),

    createVertexArray: vi.fn(() => make('vertexArray')),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(remove),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn((location: number, size: number) => {
      const bound = boundBuffers.get(CONSTANTS.ARRAY_BUFFER)
      attributeBindings.push({ location, size, data: bound?.data ?? [] })
    }),

    getUniformLocation: vi.fn((program: unknown, name: string) => {
      const key = `${(program as FakeResource).id}:${name}`
      let location = uniformLocations.get(key)
      if (!location) {
        location = { name, program }
        uniformLocations.set(key, location)
      }
      return location
    }),
    uniformMatrix4fv: vi.fn((location: unknown, transpose: boolean, value: Iterable<number>) =>
      record(location, value, transpose),
    ),
    uniformMatrix3fv: vi.fn((location: unknown, transpose: boolean, value: Iterable<number>) =>
      record(location, value, transpose),
    ),
    uniform3fv: vi.fn((location: unknown, value: Iterable<number>) => record(location, value)),
    // Un seul nombre : rangé dans un tableau pour partager `record` avec les autres uniforms.
    uniform1i: vi.fn((location: unknown, value: number) => record(location, [value])),
    uniform1f: vi.fn((location: unknown, value: number) => record(location, [value])),

    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn((capability: number) => {
      enabledCapabilities.add(capability)
    }),
    disable: vi.fn((capability: number) => {
      enabledCapabilities.delete(capability)
    }),
    cullFace: vi.fn((mode: number) => {
      cullFaceMode = mode
    }),
    frontFace: vi.fn(),
    polygonOffset: vi.fn(),
    viewport: vi.fn(),
    drawElements: vi.fn((mode: number, count: number) => {
      drawLog.push({
        call: 'drawElements',
        mode,
        count,
        program: currentProgram,
        polygonOffsetFill: enabledCapabilities.has(CONSTANTS.POLYGON_OFFSET_FILL),
      })
    }),
    drawArrays: vi.fn((mode: number, _first: number, count: number) => {
      drawLog.push({
        call: 'drawArrays',
        mode,
        count,
        program: currentProgram,
        polygonOffsetFill: enabledCapabilities.has(CONSTANTS.POLYGON_OFFSET_FILL),
      })
    }),

    isContextLost: vi.fn(() => contextLost),

    // Utilisés par la détection de WebGL, qui libère son contexte de test.
    getExtension: vi.fn(() => null),
  }

  return {
    /** Le faux contexte, typé comme un vrai pour pouvoir le passer au code testé. */
    gl: mocks as unknown as WebGL2RenderingContext,
    /** Les mêmes fonctions, avec leurs méthodes de vérification (`toHaveBeenCalled`...). */
    mocks,
    /** Nombre de ressources créées et pas encore supprimées, par type. */
    liveCounts(): Record<ResourceKind, number> {
      const counts: Record<ResourceKind, number> = { shader: 0, program: 0, buffer: 0, vertexArray: 0 }
      for (const resource of live) counts[resource.kind]++
      return counts
    },
    /** Nombre total de ressources créées depuis le début (supprimées ou non). */
    createdCount: () => created,
    /**
     * Simule une perte de contexte : le GPU a tout détruit, sans qu'aucun delete* soit appelé, et le
     * contexte restauré repart avec les réglages d'état par défaut.
     */
    loseAllResources() {
      live.clear()
      enabledCapabilities.clear()
      cullFaceMode = CONSTANTS.BACK
      currentProgram = undefined
    },
    /** Vrai si `enable(capability)` a été appelé (et pas défait par `disable`) depuis la création ou la dernière perte. */
    isEnabled: (capability: number) => enabledCapabilities.has(capability),
    /** La face éliminée par le culling (BACK par défaut, comme dans WebGL). */
    cullFaceMode: () => cullFaceMode,
    /** Historique des valeurs envoyées pour un uniform (tous programmes confondus ; chaque envoi note son programme). */
    uniformHistory: (name: string) => uniformHistory.get(name) ?? [],
    /** Les dessins lancés, dans l'ordre, avec le programme actif et l'état du polygon offset à ce moment. */
    draws: () => [...drawLog],
    /** Fait répondre `isContextLost` vrai ou faux (la perte arrive pendant une création, par exemple). */
    setContextLost(lost: boolean) {
      contextLost = lost
    },
    /** Vide la liste des dessins (pour ne regarder que les dessins suivants). */
    clearDraws() {
      drawLog.length = 0
    },
    /** Dernière valeur envoyée pour un uniform. */
    lastUniform: (name: string) => uniformHistory.get(name)?.at(-1)?.values,
    /** Pour chaque `vertexAttribPointer`, l'entrée du shader branchée et les données du buffer qui l'alimente. */
    attributeBindings: () => [...attributeBindings],
    /** Ajoute une erreur WebGL en attente (par exemple une erreur ancienne, avant la création d'un maillage). */
    queueError(code: number) {
      pendingErrors.push(code)
    },
    /** Change la taille du tampon de dessin (le vrai canvas la fixe via canvas.width). */
    setSize(width: number, height: number) {
      size.width = width
      size.height = height
    },
  }
}

export type FakeGl = ReturnType<typeof createFakeGl>
