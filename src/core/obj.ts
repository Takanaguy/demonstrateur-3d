/**
 * Analyseur de fichiers Wavefront OBJ, écrit à la main, sans React ni WebGL.
 *
 * Un fichier OBJ est du texte, une instruction par ligne. Celles qu'on utilise :
 * - `v x y z`        une position (un point de l'espace) ;
 * - `vn x y z`       une normale (la direction « vers l'extérieur » de la surface) ;
 * - `vt u v`         une coordonnée de texture (lue et vérifiée, mais ignorée : pas de textures) ;
 * - `f a b c ...`    une face, donnée par des références aux positions (et aux normales) déjà lues.
 * Tout le reste (`o`, `g`, `s`, `usemtl`, `mtllib`...) est ignoré sans erreur, de même que les
 * commentaires (`#`) et les lignes vides.
 *
 * COMMENT ÇA MARCHE, EN CINQ ÉTAPES
 * 1. Lecture ligne par ligne, avec le numéro de ligne gardé pour les messages d'erreur.
 * 2. Les nombres sont lus strictement (pas de NaN, pas d'infini), les indices de face sont
 *    vérifiés : ils commencent à 1 (pas à 0), et un indice NÉGATIF compte à partir de la fin
 *    (-1 = le dernier élément lu jusque-là).
 * 3. Une face de plus de 3 sommets est découpée en triangles « en éventail » : (0,1,2),
 *    (0,2,3), (0,3,4)... Hypothèse : le polygone est CONVEXE et plan. Sur un polygone concave,
 *    l'éventail peut recouvrir l'extérieur de la forme ; il n'y a pas de vraie triangulation ici.
 * 4. Déduplication : un sommet GPU est une combinaison (position, normale). Dans un OBJ, une
 *    même position est souvent citée par plusieurs faces avec la même normale : on ne crée le
 *    sommet qu'une fois (grâce à une `Map`) et les triangles le réutilisent par son indice.
 * 5. Sans normales dans le fichier, on les calcule (voir `computeSmoothNormals`).
 *
 * ENTRÉE NON FIABLE. Le fichier vient de l'utilisateur : il peut être énorme, mal formé ou
 * piégé. Des LIMITES (constantes `MAX_OBJ_*`) l'arrêtent avant qu'il ne fige l'onglet, et chaque
 * erreur lève une `ObjParseError` en français avec le numéro de ligne. L'analyse ne contient ni
 * récursion, ni `eval`, ni expression régulière capable de s'emballer (on découpe avec `split`
 * et on ne teste que de petits motifs sans répétition imbriquée).
 */

import { computeSmoothNormals, createIndexArray, type Mesh } from './mesh'

/** Taille maximale du texte, en caractères (et, côté interface, du fichier en octets) : 50 Mo. */
export const MAX_OBJ_TEXT_LENGTH = 50 * 1024 * 1024
/** Longueur maximale d'une ligne. Une face à 1 000 sommets en fait moins de 20 000 ; au-delà, c'est suspect. */
export const MAX_OBJ_LINE_LENGTH = 100_000
/** Nombre maximal de lignes `v`, de lignes `vn` et de lignes `vt` (chacune a son propre plafond). */
export const MAX_OBJ_VERTICES = 1_000_000
/** Nombre maximal de lignes `f`. */
export const MAX_OBJ_FACES = 500_000
/** Nombre maximal de triangles, une fois les faces découpées (un polygone à n sommets en donne n - 2). */
export const MAX_OBJ_TRIANGLES = 1_000_000
/** Nombre maximal de sommets d'une seule face. Les disques des cylindres exportés en ont une centaine. */
export const MAX_OBJ_FACE_VERTICES = 1_000

export interface ObjLimits {
  maxTextLength: number
  maxLineLength: number
  maxVertices: number
  maxFaces: number
  maxTriangles: number
  maxFaceVertices: number
}

export const DEFAULT_OBJ_LIMITS: Readonly<ObjLimits> = {
  maxTextLength: MAX_OBJ_TEXT_LENGTH,
  maxLineLength: MAX_OBJ_LINE_LENGTH,
  maxVertices: MAX_OBJ_VERTICES,
  maxFaces: MAX_OBJ_FACES,
  maxTriangles: MAX_OBJ_TRIANGLES,
  maxFaceVertices: MAX_OBJ_FACE_VERTICES,
}

/** Erreur de lecture d'un fichier OBJ. `line` vaut le numéro de ligne (à partir de 1), ou `null` si l'erreur concerne tout le fichier. */
export class ObjParseError extends Error {
  readonly line: number | null

  constructor(message: string, line: number | null = null) {
    super(line === null ? message : `Ligne ${line} : ${message}`)
    this.name = 'ObjParseError'
    this.line = line
  }
}

/** Un nombre ne contient que ces caractères : cela écarte `NaN`, `Infinity`, `0x10`... avant `Number()`. */
const NUMBER_CHARACTERS = /^[0-9eE+\-.]+$/
/** Un indice est un entier relatif écrit en chiffres décimaux. */
const INTEGER = /^[+-]?[0-9]+$/

/** Raccourcit un texte venu du fichier avant de l'afficher dans un message (il peut être très long). */
function excerpt(text: string): string {
  return text.length > 30 ? `${text.slice(0, 30)}...` : text
}

/**
 * Lit un nombre. Il est arrondi tout de suite à la précision 32 bits du GPU : un nombre trop
 * grand pour un flottant 32 bits deviendrait sinon un infini silencieux au moment de remplir
 * les tableaux, et ferait des NaN dans tous les calculs suivants.
 */
function parseNumber(token: string, line: number, what: string): number {
  if (!NUMBER_CHARACTERS.test(token)) {
    throw new ObjParseError(`${what} invalide : « ${excerpt(token)} » n'est pas un nombre.`, line)
  }
  const value = Number(token)
  if (Number.isNaN(value)) {
    throw new ObjParseError(`${what} invalide : « ${excerpt(token)} » n'est pas un nombre.`, line)
  }
  const rounded = Math.fround(value)
  if (!Number.isFinite(rounded)) {
    throw new ObjParseError(`${what} invalide : « ${excerpt(token)} » est trop grand ou infini.`, line)
  }
  return rounded
}

/**
 * Lit un indice d'un élément (position, texture ou normale) et le convertit en indice « à partir
 * de 0 ». Dans un OBJ, 1 désigne le premier élément et -1 le dernier élément déjà lu (`count`
 * est le nombre d'éléments lus jusque-là : une face ne peut citer que ce qui précède).
 */
function parseIndex(token: string, count: number, what: string, line: number): number {
  if (!INTEGER.test(token)) {
    throw new ObjParseError(`Indice de ${what} invalide : « ${excerpt(token)} ».`, line)
  }
  const index = Number(token)
  if (index === 0) {
    throw new ObjParseError(`Indice de ${what} nul : les indices d'un OBJ commencent à 1.`, line)
  }
  const resolved = index > 0 ? index - 1 : count + index
  if (resolved < 0 || resolved >= count) {
    throw new ObjParseError(
      `Indice de ${what} hors limites : ${index} (le fichier n'a lu que ${count} ${what}(s) jusque-là).`,
      line,
    )
  }
  return resolved
}

/** Normalise la normale lue dans le fichier ; elle peut ne pas être de longueur 1, ou être nulle. */
function normalizeFileNormal(x: number, y: number, z: number, line: number): [number, number, number] {
  const len = Math.hypot(x, y, z)
  if (!(len > 0) || !Number.isFinite(len)) {
    throw new ObjParseError('Normale de longueur nulle : sa direction est indéfinie.', line)
  }
  return [Math.fround(x / len), Math.fround(y / len), Math.fround(z / len)]
}

/**
 * Transforme le texte d'un fichier OBJ en maillage.
 *
 * Les positions inutilisées par aucune face sont ignorées (elles ne comptent pas dans le
 * maillage ni dans sa boîte englobante). Si la moindre face n'a pas de normale, toutes les
 * normales du fichier sont ignorées et recalculées : mélanger des normales du fichier et des
 * normales calculées donnerait un éclairage incohérent d'une face à l'autre.
 *
 * `overrides` remplace une ou plusieurs limites (utile pour les tests, qui n'ont pas besoin de
 * fabriquer un fichier de 50 Mo pour vérifier qu'une limite fonctionne).
 */
export function parseObj(text: string, overrides: Partial<ObjLimits> = {}): Mesh {
  const limits: ObjLimits = { ...DEFAULT_OBJ_LIMITS, ...overrides }
  if (text.length > limits.maxTextLength) {
    throw new ObjParseError(
      `Le fichier est trop gros : ${text.length} caractères (maximum : ${limits.maxTextLength}).`,
    )
  }

  const positions: number[] = [] // x, y, z à la suite, pour chaque ligne `v`
  const fileNormals: number[] = [] // idem pour `vn`, déjà normalisées
  let textureCount = 0
  // Les « coins » de triangle, dans l'ordre : pour chacun, l'indice de sa position et de sa normale
  // (-1 si la face n'en donne pas). Trois coins consécutifs forment un triangle.
  const cornerPositions: number[] = []
  const cornerNormals: number[] = []
  let faceCount = 0

  /** Traite une ligne, déjà débarrassée de son commentaire et de ses espaces de bord. */
  const readLine = (content: string, line: number) => {
    const tokens = content.split(/[ \t]+/)
    const directive = tokens[0]
    const argumentCount = tokens.length - 1

    switch (directive) {
      case 'v': {
        // Après x y z peuvent venir un `w` ou trois couleurs : on les ignore.
        if (argumentCount < 3) {
          throw new ObjParseError(`Une position (v) a besoin de 3 coordonnées, ${argumentCount} trouvée(s).`, line)
        }
        if (positions.length / 3 >= limits.maxVertices) {
          throw new ObjParseError(`Trop de positions (v) : maximum ${limits.maxVertices}.`, line)
        }
        positions.push(
          parseNumber(tokens[1]!, line, 'Coordonnée x'),
          parseNumber(tokens[2]!, line, 'Coordonnée y'),
          parseNumber(tokens[3]!, line, 'Coordonnée z'),
        )
        break
      }
      case 'vn': {
        if (argumentCount < 3) {
          throw new ObjParseError(`Une normale (vn) a besoin de 3 coordonnées, ${argumentCount} trouvée(s).`, line)
        }
        if (fileNormals.length / 3 >= limits.maxVertices) {
          throw new ObjParseError(`Trop de normales (vn) : maximum ${limits.maxVertices}.`, line)
        }
        const x = parseNumber(tokens[1]!, line, 'Coordonnée x de la normale')
        const y = parseNumber(tokens[2]!, line, 'Coordonnée y de la normale')
        const z = parseNumber(tokens[3]!, line, 'Coordonnée z de la normale')
        fileNormals.push(...normalizeFileNormal(x, y, z, line))
        break
      }
      case 'vt': {
        if (argumentCount < 1) {
          throw new ObjParseError('Une coordonnée de texture (vt) a besoin d\'au moins 1 valeur.', line)
        }
        if (textureCount >= limits.maxVertices) {
          throw new ObjParseError(`Trop de coordonnées de texture (vt) : maximum ${limits.maxVertices}.`, line)
        }
        // Valeurs vérifiées (un fichier corrompu doit être signalé) puis jetées : pas de textures pour le moment.
        for (let i = 1; i <= Math.min(argumentCount, 3); i++) {
          parseNumber(tokens[i]!, line, 'Coordonnée de texture')
        }
        textureCount++
        break
      }
      case 'f': {
        readFace(tokens, line)
        break
      }
      default:
        // Directive inconnue ou sans intérêt ici (o, g, s, usemtl, mtllib...) : ignorée.
        break
    }
  }

  const readFace = (tokens: string[], line: number) => {
    const cornerCount = tokens.length - 1
    if (cornerCount < 3) {
      throw new ObjParseError(`Une face (f) a besoin d'au moins 3 sommets, ${cornerCount} trouvé(s).`, line)
    }
    // Contrôlé AVANT de lire les sommets : sans cela, une face géante ferait un long travail inutile.
    if (cornerCount > limits.maxFaceVertices) {
      throw new ObjParseError(`Face trop grande : ${cornerCount} sommets (maximum ${limits.maxFaceVertices}).`, line)
    }
    if (faceCount >= limits.maxFaces) {
      throw new ObjParseError(`Trop de faces (f) : maximum ${limits.maxFaces}.`, line)
    }
    const newTriangles = cornerCount - 2
    if (cornerPositions.length / 3 + newTriangles > limits.maxTriangles) {
      throw new ObjParseError(`Trop de triangles : maximum ${limits.maxTriangles}.`, line)
    }

    // Chaque élément d'une face s'écrit `v`, `v/vt`, `v/vt/vn` ou `v//vn`.
    const facePositions: number[] = []
    const faceNormals: number[] = []
    for (let i = 1; i <= cornerCount; i++) {
      const parts = tokens[i]!.split('/')
      if (parts.length > 3) {
        throw new ObjParseError(`Sommet de face mal formé : « ${excerpt(tokens[i]!)} ».`, line)
      }
      facePositions.push(parseIndex(parts[0]!, positions.length / 3, 'position', line))
      if (parts[1]) parseIndex(parts[1], textureCount, 'texture', line) // vérifié puis ignoré
      faceNormals.push(parts[2] ? parseIndex(parts[2], fileNormals.length / 3, 'normale', line) : -1)
    }

    // Triangulation en éventail autour du premier sommet : (0, i, i + 1). Un triangle est déjà son propre éventail.
    for (let i = 1; i + 1 < cornerCount; i++) {
      for (const corner of [0, i, i + 1]) {
        cornerPositions.push(facePositions[corner]!)
        cornerNormals.push(faceNormals[corner]!)
      }
    }
    faceCount++
  }

  // --- Étape 1 : lecture ligne par ligne. On cherche les fins de ligne à la main plutôt que de
  // `split('\n')` tout le texte : cela évite de créer d'un coup des millions de petites chaînes.
  // Le CRLF (Windows) est géré : le `\r` restant en fin de ligne est enlevé par `trim()`.
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0 // un BOM éventuel en tête n'est pas du contenu
  let lineNumber = 0
  while (start <= text.length) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    lineNumber++
    if (end - start > limits.maxLineLength) {
      throw new ObjParseError(`Ligne trop longue (maximum ${limits.maxLineLength} caractères).`, lineNumber)
    }

    let content = text.slice(start, end)
    const comment = content.indexOf('#') // un commentaire peut aussi suivre des données
    if (comment !== -1) content = content.slice(0, comment)
    content = content.trim()
    if (content !== '') readLine(content, lineNumber)

    start = end + 1
  }

  if (cornerPositions.length === 0) {
    throw new ObjParseError('Le fichier ne contient aucune face (ligne « f ») : il n\'y a rien à afficher.')
  }

  // --- Étapes 4 et 5 : sommets uniques, indices, normales.
  const useFileNormals = cornerNormals.every((normal) => normal >= 0)
  // Clé d'un sommet = (position, normale) réunis en un seul nombre. Sans normales de fichier, la
  // position suffit. Le produit reste un entier exact (< 2^53) avec les limites par défaut.
  const normalStride = useFileNormals ? fileNormals.length / 3 : 1
  const vertexIds = new Map<number, number>()
  const vertexPositionSource: number[] = [] // pour chaque sommet créé, d'où vient sa position
  const vertexNormalSource: number[] = []
  const vertexOfCorner = new Array<number>(cornerPositions.length)

  for (let corner = 0; corner < cornerPositions.length; corner++) {
    const normalIndex = useFileNormals ? cornerNormals[corner]! : 0
    const key = cornerPositions[corner]! * normalStride + normalIndex
    let id = vertexIds.get(key)
    if (id === undefined) {
      id = vertexIds.size
      vertexIds.set(key, id)
      vertexPositionSource.push(cornerPositions[corner]!)
      vertexNormalSource.push(normalIndex)
    }
    vertexOfCorner[corner] = id
  }

  const vertexTotal = vertexIds.size
  const meshPositions = new Float32Array(vertexTotal * 3)
  for (let v = 0; v < vertexTotal; v++) {
    const source = vertexPositionSource[v]! * 3
    meshPositions.set([positions[source]!, positions[source + 1]!, positions[source + 2]!], v * 3)
  }

  const indices = createIndexArray(vertexOfCorner.length, vertexTotal)
  for (let corner = 0; corner < vertexOfCorner.length; corner++) indices[corner] = vertexOfCorner[corner]!

  let meshNormals: Float32Array
  if (useFileNormals) {
    meshNormals = new Float32Array(vertexTotal * 3)
    for (let v = 0; v < vertexTotal; v++) {
      const source = vertexNormalSource[v]! * 3
      meshNormals.set([fileNormals[source]!, fileNormals[source + 1]!, fileNormals[source + 2]!], v * 3)
    }
  } else {
    meshNormals = computeSmoothNormals(meshPositions, indices)
  }

  return { positions: meshPositions, normals: meshNormals, indices }
}
