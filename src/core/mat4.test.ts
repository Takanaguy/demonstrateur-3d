import {
  identity,
  lookAt,
  multiply,
  normalMatrix,
  perspective,
  rotationX,
  rotationY,
  rotationZ,
  scale,
  translation,
  type Mat4,
} from './mat4'
import { cross, dot, length, normalize, type Vec3 } from './vec3'

/** Applique une matrice 4x4 (colonnes-majeures) à un point, puis divise par w comme le fait le GPU. */
function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!
  const z = m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!
  return [x / w, y / w, z / w]
}

function expectVec3(actual: Vec3, expected: Vec3) {
  expect(actual[0]).toBeCloseTo(expected[0], 5)
  expect(actual[1]).toBeCloseTo(expected[1], 5)
  expect(actual[2]).toBeCloseTo(expected[2], 5)
}

/** Compare deux matrices valeur par valeur, avec une tolérance (et sans distinguer 0 de -0). */
function expectMatrix(actual: ArrayLike<number>, expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 5))
}

/** Une matrice quelconque (ni symétrique ni creuse) pour que les tests d'ordre aient un sens. */
const sample: Mat4 = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

describe('identity et multiply', () => {
  it('identity a des 1 sur la diagonale et des 0 ailleurs', () => {
    const id = identity()
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(id[c * 4 + r]).toBe(r === c ? 1 : 0)
      }
    }
  })

  it('identité x M = M et M x identité = M', () => {
    expect(multiply(identity(), sample)).toEqual(sample)
    expect(multiply(sample, identity())).toEqual(sample)
  })

  it('donne des valeurs connues, colonnes-majeures (calcul fait à la main)', () => {
    // a = 2 sur la diagonale sauf le dernier ; b = sample. Chaque colonne de sample est doublée
    // sur ses 3 premières lignes, la dernière ligne est inchangée.
    const a = scale(2, 2, 2)
    expect(Array.from(multiply(a, sample))).toEqual([2, 4, 6, 4, 10, 12, 14, 8, 18, 20, 22, 12, 26, 28, 30, 16])
  })

  it("n'est pas commutatif : l'ordre des facteurs compte", () => {
    const ab = multiply(translation(1, 0, 0), scale(2, 2, 2))
    const ba = multiply(scale(2, 2, 2), translation(1, 0, 0))
    expect(ab).not.toEqual(ba)
  })

  it('applique le facteur de DROITE en premier : (T x S) p = T (S p)', () => {
    // Mise à l'échelle x2 d'abord (1 -> 2), puis translation de +1 : résultat 3 (et non 4).
    const m = multiply(translation(1, 0, 0), scale(2, 2, 2))
    expectVec3(transformPoint(m, [1, 0, 0]), [3, 0, 0])
    const reversed = multiply(scale(2, 2, 2), translation(1, 0, 0))
    expectVec3(transformPoint(reversed, [1, 0, 0]), [4, 0, 0])
  })

  it("ne modifie pas ses opérandes et renvoie un nouveau tableau", () => {
    const a = sample.slice()
    const b = identity()
    const out = multiply(a, b)
    expect(a).toEqual(sample)
    expect(out).not.toBe(a)
    expect(out).not.toBe(b)
  })
})

describe('translation, scale, rotations', () => {
  it('translation déplace un point mais pas une direction (w = 0)', () => {
    expectVec3(transformPoint(translation(1, 2, 3), [10, 10, 10]), [11, 12, 13])
    // Une direction ne doit pas être déplacée : on lit seulement la partie 3x3.
    const t = translation(1, 2, 3)
    expect([t[0], t[5], t[10]]).toEqual([1, 1, 1])
  })

  it('translation range le déplacement dans la 4e colonne (indices 12 à 14)', () => {
    const t = translation(4, 5, 6)
    expect([t[12], t[13], t[14], t[15]]).toEqual([4, 5, 6, 1])
  })

  it('scale multiplie chaque axe séparément', () => {
    expectVec3(transformPoint(scale(2, 3, 4), [1, 1, 1]), [2, 3, 4])
  })

  it('rotationX d\'un quart de tour envoie Y sur Z', () => {
    expectVec3(transformPoint(rotationX(Math.PI / 2), [0, 1, 0]), [0, 0, 1])
  })

  it('rotationY d\'un quart de tour envoie Z sur X (et X sur -Z)', () => {
    expectVec3(transformPoint(rotationY(Math.PI / 2), [0, 0, 1]), [1, 0, 0])
    expectVec3(transformPoint(rotationY(Math.PI / 2), [1, 0, 0]), [0, 0, -1])
  })

  it('rotationZ d\'un quart de tour envoie X sur Y', () => {
    expectVec3(transformPoint(rotationZ(Math.PI / 2), [1, 0, 0]), [0, 1, 0])
  })

  it('une rotation conserve les longueurs', () => {
    const p: Vec3 = [1, 2, 3]
    for (const rot of [rotationX, rotationY, rotationZ]) {
      expect(length(transformPoint(rot(0.7), p))).toBeCloseTo(length(p), 5)
    }
  })

  it('rotation de 0 = identité ; deux demi-tours = un tour entier', () => {
    expectMatrix(rotationY(0), Array.from(identity()))
    const full = multiply(rotationZ(Math.PI), rotationZ(Math.PI))
    for (let i = 0; i < 16; i++) {
      expect(full[i]).toBeCloseTo(identity()[i]!, 5)
    }
  })
})

describe('perspective', () => {
  const fovY = Math.PI / 2 // f = 1 / tan(45 deg) = 1
  const near = 1
  const far = 11

  it('correspond à la formule : valeurs connues pour fov 90, aspect 2, near 1, far 11', () => {
    const p = perspective(fovY, 2, near, far)
    expect(p[0]).toBeCloseTo(0.5) // f / aspect
    expect(p[5]).toBeCloseTo(1) // f
    expect(p[10]).toBeCloseTo(-1.2) // (far + near) / (near - far) = 12 / -10
    expect(p[11]).toBe(-1) // copie -z dans w
    expect(p[14]).toBeCloseTo(-2.2) // 2 * far * near / (near - far) = 22 / -10
    expect(p[15]).toBe(0)
    // Tout le reste est nul.
    for (const i of [1, 2, 3, 4, 6, 7, 8, 9, 12, 13]) expect(p[i]).toBe(0)
  })

  it('envoie le plan near sur z = -1 et le plan far sur z = +1 (profondeur normalisée)', () => {
    const p = perspective(fovY, 1, near, far)
    expect(transformPoint(p, [0, 0, -near])[2]).toBeCloseTo(-1, 5)
    expect(transformPoint(p, [0, 0, -far])[2]).toBeCloseTo(1, 5)
  })

  it('le bord du champ de vision tombe sur le bord de l\'écran (y = 1 à 45 degrés)', () => {
    const p = perspective(fovY, 1, near, far)
    // À la distance 5, la demi-hauteur visible est 5 * tan(45 deg) = 5.
    expect(transformPoint(p, [0, 5, -5])[1]).toBeCloseTo(1, 5)
  })

  it("tient compte de l'aspect : la largeur visible est aspect fois la hauteur", () => {
    const p = perspective(fovY, 2, near, far)
    expect(transformPoint(p, [10, 0, -5])[0]).toBeCloseTo(1, 5) // demi-largeur = 5 * 2 = 10
  })

  it.each<[string, [number, number, number, number]]>([
    ['aspect nul', [Math.PI / 4, 0, 0.1, 100]],
    ['aspect négatif', [Math.PI / 4, -1, 0.1, 100]],
    ['aspect NaN', [Math.PI / 4, NaN, 0.1, 100]],
    ['aspect infini', [Math.PI / 4, Infinity, 0.1, 100]],
    ['near = far', [Math.PI / 4, 1, 5, 5]],
    ['near > far', [Math.PI / 4, 1, 10, 1]],
    ['near nul', [Math.PI / 4, 1, 0, 100]],
    ['near négatif', [Math.PI / 4, 1, -1, 100]],
    ['far infini', [Math.PI / 4, 1, 0.1, Infinity]],
    ['fov nul', [0, 1, 0.1, 100]],
    ['fov de 180 degrés', [Math.PI, 1, 0.1, 100]],
    ['fov NaN', [NaN, 1, 0.1, 100]],
  ])('refuse les paramètres invalides : %s', (_label, args) => {
    expect(() => perspective(...args)).toThrow(RangeError)
  })

  it('le message d\'erreur dit ce qui ne va pas', () => {
    expect(() => perspective(1, 0, 0.1, 100)).toThrow(/largeur\/hauteur/)
    expect(() => perspective(1, 1, 5, 5)).toThrow(/near/)
  })
})

describe('lookAt', () => {
  it('cas simple : œil en (0,0,5) qui regarde l\'origine = translation de -5 en Z', () => {
    const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
    expectMatrix(view, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1])
  })

  it("place la cible devant la caméra, sur l'axe -Z, à la bonne distance", () => {
    const view = lookAt([3, 4, 5], [0, 0, 0], [0, 1, 0])
    const distance = Math.hypot(3, 4, 5)
    expectVec3(transformPoint(view, [0, 0, 0]), [0, 0, -distance])
  })

  it("met l'œil à l'origine", () => {
    const eye: Vec3 = [1, 2, 3]
    expectVec3(transformPoint(lookAt(eye, [4, -1, 0], [0, 1, 0]), eye), [0, 0, 0])
  })

  it('le haut de la caméra reste vers +Y et la droite vers +X pour une caméra qui regarde -Z', () => {
    const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
    expectVec3(transformPoint(view, [1, 0, 5]), [1, 0, 0]) // à droite de l'œil
    expectVec3(transformPoint(view, [0, 1, 5]), [0, 1, 0]) // au-dessus de l'œil
  })

  it('un regard vers +X (œil à l\'origine) envoie +X sur -Z', () => {
    const view = lookAt([0, 0, 0], [1, 0, 0], [0, 1, 0])
    expectVec3(transformPoint(view, [2, 0, 0]), [0, 0, -2])
  })

  it('la partie 3x3 est orthonormée (rotation pure)', () => {
    const view = lookAt([3, 4, 5], [1, -1, 0], [0, 1, 0])
    const x: Vec3 = [view[0]!, view[4]!, view[8]!]
    const y: Vec3 = [view[1]!, view[5]!, view[9]!]
    const z: Vec3 = [view[2]!, view[6]!, view[10]!]
    expect(length(x)).toBeCloseTo(1, 5)
    expect(length(y)).toBeCloseTo(1, 5)
    expect(length(z)).toBeCloseTo(1, 5)
    expect(dot(x, y)).toBeCloseTo(0, 5)
    expect(dot(x, z)).toBeCloseTo(0, 5)
    expectVec3(cross(x, y), z)
  })

  it('refuse un œil confondu avec la cible', () => {
    expect(() => lookAt([1, 1, 1], [1, 1, 1], [0, 1, 0])).toThrow(RangeError)
  })

  it('refuse un « haut » nul ou parallèle au regard', () => {
    expect(() => lookAt([0, 5, 0], [0, 0, 0], [0, 1, 0])).toThrow(/parallèle/)
    expect(() => lookAt([0, 5, 0], [0, 0, 0], [0, -2, 0])).toThrow(/parallèle/)
    expect(() => lookAt([0, 0, 5], [0, 0, 0], [0, 0, 0])).toThrow(/nulle/)
  })

  it('refuse des valeurs non finies', () => {
    expect(() => lookAt([NaN, 0, 5], [0, 0, 0], [0, 1, 0])).toThrow(RangeError)
  })
})

describe('normalMatrix', () => {
  it("pour une rotation, c'est la partie 3x3 de la rotation elle-même", () => {
    const n = normalMatrix(rotationY(0.9))
    const r = rotationY(0.9)
    const expected = [r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]]
    expect(n).toHaveLength(9)
    expected.forEach((value, i) => expect(n[i]).toBeCloseTo(value!, 5))
  })

  it("pour l'identité, donne l'identité 3x3", () => {
    expect(Array.from(normalMatrix(identity()))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it("ignore la translation", () => {
    expect(Array.from(normalMatrix(translation(5, 6, 7)))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it("inverse les facteurs d'une mise à l'échelle non uniforme : diag(2, 1, 4) -> diag(1/2, 1, 1/4)", () => {
    const n = normalMatrix(scale(2, 1, 4))
    expect(Array.from(n)).toEqual([0.5, 0, 0, 0, 1, 0, 0, 0, 0.25])
  })

  it('garde la normale perpendiculaire à la surface malgré un étirement non uniforme', () => {
    // Un plan incliné à 45 degrés : tangente t = (1, -1, 0), normale n = (1, 1, 0) (t . n = 0).
    const model = multiply(rotationZ(0.3), scale(4, 1, 1))
    const t: Vec3 = [1, -1, 0]
    const n: Vec3 = [1, 1, 0]
    const tWorld = transformPoint(model, t) // pas de translation, w = 1 : c'est M * t
    const m3 = normalMatrix(model)
    const nWorld: Vec3 = [
      m3[0]! * n[0] + m3[3]! * n[1] + m3[6]! * n[2],
      m3[1]! * n[0] + m3[4]! * n[1] + m3[7]! * n[2],
      m3[2]! * n[0] + m3[5]! * n[1] + m3[8]! * n[2],
    ]
    expect(dot(nWorld, tWorld)).toBeCloseTo(0, 5)

    // Contre-exemple : transformer la normale avec le modèle lui-même la rend oblique.
    const nWrong = transformPoint(model, n)
    expect(Math.abs(dot(normalize(nWrong), normalize(tWorld)))).toBeGreaterThan(0.1)
  })

  it('le produit de la matrice normale par la 3x3 du modèle donne l\'identité (inverse transposée)', () => {
    // N^T x M = I, donc pour chaque colonne j de M et chaque colonne i de N, N_i . M_j = (i == j).
    const model = multiply(rotationX(0.5), scale(2, 3, 0.5))
    const n = normalMatrix(model)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const ni: Vec3 = [n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!]
        const mj: Vec3 = [model[j * 4]!, model[j * 4 + 1]!, model[j * 4 + 2]!]
        expect(dot(ni, mj)).toBeCloseTo(i === j ? 1 : 0, 5)
      }
    }
  })

  it("refuse un modèle non inversible (un axe écrasé à 0)", () => {
    expect(() => normalMatrix(scale(1, 0, 1))).toThrow(RangeError)
  })

  it('refuse un modèle contenant des valeurs invalides', () => {
    expect(() => normalMatrix(scale(NaN, 1, 1))).toThrow(RangeError)
  })
})
