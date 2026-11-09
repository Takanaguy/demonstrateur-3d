import { triangleCount, vertexCount } from './mesh'
import {
  DEFAULT_OBJ_LIMITS,
  MAX_OBJ_FACES,
  MAX_OBJ_FACE_VERTICES,
  MAX_OBJ_LINE_LENGTH,
  MAX_OBJ_TEXT_LENGTH,
  MAX_OBJ_TRIANGLES,
  MAX_OBJ_VERTICES,
  ObjParseError,
  parseObj,
} from './obj'
import { dot, length, type Vec3 } from './vec3'

// Tous les fichiers ci-dessous sont de tout petits OBJ écrits à la main pour ces tests.

/** Un tétraèdre : 4 points, 4 faces triangulaires tournées vers l'extérieur. Pas de normales. */
const TETRAHEDRON = `# un tétraèdre
v 0 0 0
v 1 0 0
v 0 1 0
v 0 0 1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`

/** Un carré dans le plan XY, avec sa normale. */
const QUAD_WITH_NORMAL = `v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
vn 0 0 1
f 1//1 2//1 3//1 4//1
`

function vertex(data: Float32Array, i: number): Vec3 {
  return [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!]
}

/** Vérifie qu'un texte est refusé, avec ce numéro de ligne et un message contenant `pattern`. */
function expectParseError(text: string, line: number | null, pattern: RegExp, limits = {}) {
  let caught: unknown
  try {
    parseObj(text, limits)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ObjParseError)
  const error = caught as ObjParseError
  expect(error.line).toBe(line)
  expect(error.message).toMatch(pattern)
  if (line !== null) expect(error.message).toContain(`Ligne ${line} :`)
}

/** Un fichier de `count` triangles qui ne partagent aucun point : 3 x count sommets distincts. */
function separateTriangles(count: number): string {
  const lines: string[] = []
  for (let i = 0; i < count; i++) lines.push(`v ${i} 0 0`, `v ${i} 1 0`, `v ${i} 0 1`)
  for (let i = 0; i < count; i++) lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`)
  return lines.join('\n')
}

describe('parseObj : cas de base', () => {
  it('lit un tétraèdre : 4 sommets, 4 triangles, indices 16 bits', () => {
    const mesh = parseObj(TETRAHEDRON)

    expect(vertexCount(mesh)).toBe(4)
    expect(triangleCount(mesh)).toBe(4)
    expect(mesh.indices).toBeInstanceOf(Uint16Array)
    // Les sommets sont créés dans l'ordre où les faces les citent : la 1re face (1 3 2) range le point 3 avant le point 2.
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1])
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 1, 2, 1, 3])
  })

  it('un carré avec normale : 4 sommets partagés (pas 6), 2 triangles, normales du fichier', () => {
    const mesh = parseObj(QUAD_WITH_NORMAL)

    expect(vertexCount(mesh)).toBe(4)
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3])
    for (let i = 0; i < 4; i++) expect(vertex(mesh.normals, i)).toEqual([0, 0, 1])
  })

  it('normalise les normales du fichier (elles peuvent être plus longues que 1)', () => {
    const mesh = parseObj(QUAD_WITH_NORMAL.replace('vn 0 0 1', 'vn 0 0 5'))

    expect(vertex(mesh.normals, 0)).toEqual([0, 0, 1])
  })

  it('renvoie des tableaux du type attendu par le GPU', () => {
    const mesh = parseObj(TETRAHEDRON)

    expect(mesh.positions).toBeInstanceOf(Float32Array)
    expect(mesh.normals).toBeInstanceOf(Float32Array)
  })
})

describe('parseObj : formes de face', () => {
  const POSITIONS = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n'

  it.each([
    ['v', 'f 1 2 3', ''],
    ['v/vt', 'f 1/1 2/2 3/3', 'vt 0 0\nvt 1 0\nvt 0 1\n'],
    ['v/vt/vn', 'f 1/1/1 2/2/1 3/3/1', 'vt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\n'],
    ['v//vn', 'f 1//1 2//1 3//1', 'vn 0 0 1\n'],
  ])('accepte la forme « %s »', (_name, face, extra) => {
    const mesh = parseObj(`${POSITIONS}${extra}${face}\n`)

    expect(vertexCount(mesh)).toBe(3)
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2])
    // Les normales viennent du fichier si la face en donne, sinon elles sont calculées : +Z dans les deux cas.
    expect(vertex(mesh.normals, 0)).toEqual([0, 0, 1])
  })

  it('les indices négatifs comptent à partir du dernier élément lu', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n')

    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2])
  })

  it('un indice négatif est relatif à ce qui est déjà lu au moment de la face', () => {
    // -1 désigne le 4e point (5, 5, 5), lu APRÈS la première face.
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nv 5 5 5\nf -1 1 2\n')

    expect(vertexCount(mesh)).toBe(4)
    expect(vertex(mesh.positions, mesh.indices[3]!)).toEqual([5, 5, 5])
  })

  it('les indices négatifs fonctionnent aussi pour les normales', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 -1\nvn 0 0 1\nf -3//-1 -2//-1 -1//-1\n')

    expect(vertex(mesh.normals, 0)).toEqual([0, 0, 1]) // -1 = la dernière normale, +Z
  })

  it('découpe un polygone à 5 sommets en éventail : 3 triangles autour du premier sommet', () => {
    const pentagon = 'v 0 0 0\nv 2 0 0\nv 3 2 0\nv 1 3 0\nv -1 2 0\nf 1 2 3 4 5\n'

    const mesh = parseObj(pentagon)

    expect(vertexCount(mesh)).toBe(5)
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4])
  })

  it('un quadrilatère donne 2 triangles', () => {
    expect(triangleCount(parseObj(QUAD_WITH_NORMAL))).toBe(2)
  })
})

describe('parseObj : sommets uniques (déduplication)', () => {
  it('un point cité par plusieurs faces avec la même normale n\'est créé qu\'une fois', () => {
    // Deux triangles qui partagent les points 1 et 3 : 4 sommets, pas 6.
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n')

    expect(vertexCount(mesh)).toBe(4)
    expect(triangleCount(mesh)).toBe(2)
  })

  it('le même point avec deux normales différentes donne deux sommets (un sommet GPU = position + normale)', () => {
    const text = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'vn 0 0 1',
      'vn 0 1 0',
      'f 1//1 2//1 3//1',
      'f 1//2 3//2 4//2',
    ].join('\n')

    const mesh = parseObj(text)

    // Points 1 et 3 existent avec les deux normales : 3 + 3 sommets, aucun partagé.
    expect(vertexCount(mesh)).toBe(6)
    expect(triangleCount(mesh)).toBe(2)
  })

  it('les points que aucune face n\'utilise sont écartés', () => {
    const mesh = parseObj('v 100 100 100\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 2 3 4\n')

    expect(vertexCount(mesh)).toBe(3)
    expect(Array.from(mesh.positions)).not.toContain(100)
  })
})

describe('parseObj : normales calculées', () => {
  it('sans « vn », calcule des normales lisses de longueur 1, tournées vers l\'extérieur', () => {
    const mesh = parseObj(TETRAHEDRON)
    const centroid: Vec3 = [0.25, 0.25, 0.25]

    for (let i = 0; i < vertexCount(mesh); i++) {
      const normal = vertex(mesh.normals, i)
      const position = vertex(mesh.positions, i)
      expect(length(normal)).toBeCloseTo(1, 5)
      // La normale va du centre vers le sommet, pas l'inverse.
      expect(dot(normal, [position[0] - centroid[0], position[1] - centroid[1], position[2] - centroid[2]])).toBeGreaterThan(0)
    }
  })

  it('un carré plat sans normales : +Z partout', () => {
    const mesh = parseObj('v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nf 1 2 3 4\n')

    for (let i = 0; i < 4; i++) expect(vertex(mesh.normals, i)).toEqual([0, 0, 1])
  })

  it('si une seule face n\'a pas de normale, toutes celles du fichier sont ignorées et recalculées', () => {
    // La normale du fichier (-Z) contredit la géométrie (+Z) : elle ne doit pas être utilisée.
    const text = 'v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nvn 0 0 -1\nf 1//1 2//1 3//1\nf 1 3 4\n'

    const mesh = parseObj(text)

    expect(vertexCount(mesh)).toBe(4)
    expect(vertex(mesh.normals, 0)).toEqual([0, 0, 1])
  })
})

describe('parseObj : tolérance du format', () => {
  const EXPECTED = parseObj(TETRAHEDRON)

  it('les fins de ligne CRLF (Windows) donnent le même maillage que LF', () => {
    const crlf = parseObj(TETRAHEDRON.replace(/\n/g, '\r\n'))

    expect(Array.from(crlf.positions)).toEqual(Array.from(EXPECTED.positions))
    expect(Array.from(crlf.indices)).toEqual(Array.from(EXPECTED.indices))
  })

  it('ignore commentaires, lignes vides, espaces et tabulations en trop', () => {
    const messy = [
      '# commentaire',
      '',
      '   ',
      'v   0\t0 0   # commentaire en fin de ligne',
      '  v 1 0 0',
      'v 0 1 0',
      'v 0 0 1',
      '',
      'f 1 3 2',
      'f 1 2 4',
      'f\t1 4 3',
      'f 2 3 4 # dernier',
    ].join('\n')

    const mesh = parseObj(messy)

    expect(Array.from(mesh.positions)).toEqual(Array.from(EXPECTED.positions))
    expect(Array.from(mesh.indices)).toEqual(Array.from(EXPECTED.indices))
  })

  it('ignore un éventuel w ou des couleurs après x y z', () => {
    const mesh = parseObj('v 0 0 0 1\nv 1 0 0 0.5 0.5 0.5\nv 0 1 0\nf 1 2 3\n')

    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })

  it('ignore les directives inconnues sans erreur', () => {
    const text = 'mtllib scene.mtl\no objet\ng groupe\ns off\nusemtl rouge\nl 1 2\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'

    expect(triangleCount(parseObj(text))).toBe(1)
  })

  it('lit les coordonnées de texture (vt) sans s\'en servir', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0.5\nvt 0.5 0.5 0.5\nf 1/2 2/1 3/2\n')

    expect(triangleCount(mesh)).toBe(1)
  })

  it('accepte la notation scientifique et les signes', () => {
    const mesh = parseObj('v 1e2 -2.5E-1 +3\nv 0 0 0\nv 1 0 0\nf 1 2 3\n')

    expect(vertex(mesh.positions, 0)).toEqual([100, -0.25, 3])
  })

  it('ignore le BOM éventuel en tête de fichier', () => {
    expect(triangleCount(parseObj(String.fromCharCode(0xfeff) + TETRAHEDRON))).toBe(4)
  })

  it('accepte un fichier sans retour à la ligne final', () => {
    expect(triangleCount(parseObj(TETRAHEDRON.trimEnd()))).toBe(4)
  })
})

describe('parseObj : indices 16 ou 32 bits', () => {
  it('65 535 sommets : indices 16 bits', () => {
    const mesh = parseObj(separateTriangles(21_845))

    expect(vertexCount(mesh)).toBe(65_535)
    expect(mesh.indices).toBeInstanceOf(Uint16Array)
  })

  it('65 538 sommets : indices 32 bits, et le dernier indice n\'est pas tronqué', () => {
    const mesh = parseObj(separateTriangles(21_846))

    expect(vertexCount(mesh)).toBe(65_538)
    expect(mesh.indices).toBeInstanceOf(Uint32Array)
    expect(mesh.indices[mesh.indices.length - 1]).toBe(65_537) // en 16 bits, ce serait 1
  })
})

describe('parseObj : erreurs, avec le numéro de ligne', () => {
  it.each([
    ['v avec 2 coordonnées', 'v 1 2\n', 1, /3 coordonnées/],
    ['v sans coordonnée', 'v\n', 1, /3 coordonnées/],
    ['vn avec 2 coordonnées', 'vn 1 2\n', 1, /3 coordonnées/],
    ['vt sans valeur', 'vt\n', 1, /au moins 1 valeur/],
    ['coordonnée non numérique', 'v 1 abc 3\n', 1, /Coordonnée y invalide/],
    ['NaN', 'v 1 NaN 3\n', 1, /invalide/],
    ['Infinity', 'v Infinity 0 0\n', 1, /invalide/],
    ['-Infinity', 'v 0 0 -Infinity\n', 1, /invalide/],
    ['nombre trop grand (infini)', 'v 1e999 0 0\n', 1, /trop grand ou infini/],
    ['nombre trop grand pour un flottant 32 bits', 'v 1e39 0 0\n', 1, /trop grand ou infini/],
    ['notation hexadécimale', 'v 0x10 0 0\n', 1, /n'est pas un nombre/],
    ['nombre mal formé', 'v 1.2.3 0 0\n', 1, /n'est pas un nombre/],
    ['coordonnée de texture invalide', 'vt 0.5 oups\n', 1, /texture invalide/],
    ['normale de longueur nulle', 'vn 0 0 0\n', 1, /longueur nulle/],
    ['face à 2 sommets', 'v 0 0 0\nv 1 0 0\nf 1 2\n', 3, /au moins 3 sommets/],
    ['face sans sommet', 'f\n', 1, /au moins 3 sommets/],
    ['indice nul', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n', 4, /nul/],
    ['indice hors bornes', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4\n', 4, /hors limites : 4/],
    ['indice négatif hors bornes', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -4 -2 -1\n', 4, /hors limites : -4/],
    ['face avant les points', 'f 1 2 3\n', 1, /hors limites/],
    ['indice de normale hors bornes', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//2 3//1\n', 5, /normale/],
    ['indice de texture hors bornes', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nf 1/1 2/2 3/1\n', 5, /texture/],
    ['indice non entier', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1.5 2 3\n', 4, /Indice de position invalide/],
    ['indice non numérique', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf a b c\n', 4, /Indice de position invalide/],
    ['indice vide avant la barre', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf /1 2 3\n', 4, /Indice de position invalide/],
    ['trop de barres dans un sommet', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1/1/1/1 2 3\n', 4, /mal formé/],
  ])('%s', (_name, text, line, pattern) => {
    expectParseError(text, line, pattern)
  })

  it('compte toutes les lignes (commentaires, lignes vides, CRLF) pour donner le bon numéro', () => {
    const text = '# début\r\n\r\nv 0 0 0\r\nv 1 0 0\r\nv 1 x 0\r\n'

    expectParseError(text, 5, /Coordonnée y invalide/)
  })

  it('un fichier sans aucune face est refusé (sans numéro de ligne : cela concerne tout le fichier)', () => {
    expectParseError('v 0 0 0\nv 1 0 0\nv 0 1 0\n', null, /aucune face/)
  })

  it('un fichier vide est refusé', () => {
    expectParseError('', null, /aucune face/)
  })

  it('un fichier de commentaires est refusé', () => {
    expectParseError('# rien\n\n# rien\n', null, /aucune face/)
  })

  it('l\'erreur est une Error classique, au nom lisible', () => {
    const error = new ObjParseError('oups', 7)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ObjParseError')
    expect(error.message).toBe('Ligne 7 : oups')
  })
})

describe('parseObj : limites contre les fichiers énormes ou piégés', () => {
  it('les limites par défaut sont celles documentées', () => {
    expect(DEFAULT_OBJ_LIMITS).toEqual({
      maxTextLength: MAX_OBJ_TEXT_LENGTH,
      maxLineLength: MAX_OBJ_LINE_LENGTH,
      maxVertices: MAX_OBJ_VERTICES,
      maxFaces: MAX_OBJ_FACES,
      maxTriangles: MAX_OBJ_TRIANGLES,
      maxFaceVertices: MAX_OBJ_FACE_VERTICES,
    })
  })

  it('texte trop long', () => {
    expectParseError(TETRAHEDRON, null, /trop gros/, { maxTextLength: TETRAHEDRON.length - 1 })
  })

  it('texte juste à la limite : accepté', () => {
    expect(triangleCount(parseObj(TETRAHEDRON, { maxTextLength: TETRAHEDRON.length }))).toBe(4)
  })

  it('ligne trop longue (limite par défaut), avec son numéro', () => {
    const text = `v 0 0 0\n# ${'a'.repeat(MAX_OBJ_LINE_LENGTH)}\n`

    expectParseError(text, 2, /Ligne trop longue/)
  })

  it('ligne trop longue (limite abaissée) : refusée avant d\'être analysée', () => {
    expectParseError('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3', 1, /Ligne trop longue/, { maxLineLength: 6 })
  })

  it('trop de positions (v)', () => {
    expectParseError('v 0 0 0\nv 1 0 0\nv 2 0 0\n', 3, /Trop de positions/, { maxVertices: 2 })
  })

  it('trop de normales (vn)', () => {
    expectParseError('vn 0 0 1\nvn 0 1 0\n', 2, /Trop de normales/, { maxVertices: 1 })
  })

  it('trop de coordonnées de texture (vt)', () => {
    expectParseError('vt 0 0\nvt 1 0\n', 2, /Trop de coordonnées de texture/, { maxVertices: 1 })
  })

  it('trop de faces', () => {
    const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 3\nf 1 2 3\n'

    expectParseError(text, 6, /Trop de faces/, { maxFaces: 2 })
    expect(triangleCount(parseObj(text, { maxFaces: 3 }))).toBe(3) // pile à la limite : accepté
  })

  it('trop de triangles (un polygone à 5 sommets en fait 3)', () => {
    const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv -1 0 0\nf 1 2 3 4 5\n'

    expectParseError(text, 6, /Trop de triangles/, { maxTriangles: 2 })
    expect(triangleCount(parseObj(text, { maxTriangles: 3 }))).toBe(3)
  })

  it('face avec trop de sommets', () => {
    const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n'

    expectParseError(text, 5, /Face trop grande : 4 sommets/, { maxFaceVertices: 3 })
    expect(triangleCount(parseObj(text, { maxFaceVertices: 4 }))).toBe(2)
  })

  it('un nombre de 50 000 chiffres suivi d\'une lettre est refusé tout de suite (pas d\'explosion de calcul)', () => {
    const started = Date.now()

    expectParseError(`v ${'1'.repeat(50_000)}x 0 0\n`, 1, /n'est pas un nombre/)
    expectParseError(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf ${'1'.repeat(50_000)}x 2 3\n`, 4, /Indice de position invalide/)

    expect(Date.now() - started).toBeLessThan(2000)
  })
})
