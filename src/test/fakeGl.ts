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
  DEPTH_TEST: 2929,
  CULL_FACE: 2884,
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
  const uniformLocations = new Map<string, { name: string }>()
  /** Toutes les valeurs envoyées, dans l'ordre, par nom d'uniform. */
  const uniformHistory = new Map<string, { transpose?: boolean; values: number[] }[]>()
  const record = (location: unknown, values: Iterable<number>, transpose?: boolean) => {
    const name = (location as { name: string }).name
    const history = uniformHistory.get(name) ?? []
    history.push({ transpose, values: Array.from(values) })
    uniformHistory.set(name, history)
  }

  /** Le buffer actuellement relié, par cible (ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER). */
  const boundBuffers = new Map<number, FakeResource | null>()
  const attributeBindings: AttributeBinding[] = []

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
    useProgram: vi.fn(),

    createBuffer: vi.fn(() => make('buffer')),
    bindBuffer: vi.fn((target: number, buffer: unknown) => {
      boundBuffers.set(target, buffer as FakeResource | null)
    }),
    bufferData: vi.fn((target: number, data: ArrayLike<number>) => {
      const bound = boundBuffers.get(target)
      if (bound) bound.data = Array.from(data)
    }),
    deleteBuffer: vi.fn(remove),

    createVertexArray: vi.fn(() => make('vertexArray')),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(remove),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn((location: number, size: number) => {
      const bound = boundBuffers.get(CONSTANTS.ARRAY_BUFFER)
      attributeBindings.push({ location, size, data: bound?.data ?? [] })
    }),

    getUniformLocation: vi.fn((_program: unknown, name: string) => {
      let location = uniformLocations.get(name)
      if (!location) {
        location = { name }
        uniformLocations.set(name, location)
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

    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    cullFace: vi.fn(),
    frontFace: vi.fn(),
    viewport: vi.fn(),
    drawElements: vi.fn(),

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
    /** Simule une perte de contexte : le GPU a tout détruit, sans qu'aucun delete* soit appelé. */
    loseAllResources() {
      live.clear()
    },
    /** Historique des valeurs envoyées pour un uniform. */
    uniformHistory: (name: string) => uniformHistory.get(name) ?? [],
    /** Dernière valeur envoyée pour un uniform. */
    lastUniform: (name: string) => uniformHistory.get(name)?.at(-1)?.values,
    /** Pour chaque `vertexAttribPointer`, l'entrée du shader branchée et les données du buffer qui l'alimente. */
    attributeBindings: () => [...attributeBindings],
    /** Change la taille du tampon de dessin (le vrai canvas la fixe via canvas.width). */
    setSize(width: number, height: number) {
      size.width = width
      size.height = height
    },
  }
}

export type FakeGl = ReturnType<typeof createFakeGl>
