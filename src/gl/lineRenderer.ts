/**
 * Le second programme WebGL : celui des LIGNES. Il dessine tout ce qui est fait de traits (fil de fer,
 * normales, boîte englobante, grille, axes), sans éclairage, avec `gl.LINES`. Sans React ; il ne dépend
 * que de `core/` et des helpers de `gl/`.
 *
 * Pourquoi un programme à part et pas le programme de l'objet : ce dernier calcule un éclairage à
 * partir de normales, ce que des traits n'ont pas, et il lit deux entrées (position et normale) là où
 * un trait n'a besoin que d'une position. Un programme dédié est plus court, et les traits gardent
 * leur couleur exacte.
 *
 * Utilisation : `createLineRenderer` compile le programme ; `setView` et `setProjection` reçoivent
 * les mêmes matrices que le programme de l'objet (les traits doivent se placer au même endroit) ;
 * `createSeries` envoie un tableau de segments au GPU ; `series.draw(modèle, couleur)` le dessine.
 *
 * LARGEUR DES TRAITS. Un trait fait toujours 1 pixel. `gl.lineWidth(n)` existe mais WebGL ne garantit
 * pas qu'une valeur autre que 1 soit acceptée, et presque tous les navigateurs la limitent à 1.
 * Dessiner des traits plus épais demanderait de les construire en rectangles : ce n'est pas fait.
 */

import type { Mat4 } from '../core/mat4'
import type { Vec3 } from '../core/vec3'
import { createBuffer, createVertexArray, drainGlErrors, throwIfGlError } from './buffers'
import { createProgram, findUniforms } from './shader'
import fragmentSource from './shaders/line.frag?raw'
import vertexSource from './shaders/line.vert?raw'

/** Numéro de l'entrée `aPosition` du vertex shader (le `layout(location = 0)` de line.vert). */
const POSITION_LOCATION = 0

const UNIFORM_NAMES = ['uModel', 'uView', 'uProjection', 'uColor'] as const
type UniformName = (typeof UNIFORM_NAMES)[number]

/** Un lot de segments déjà envoyé au GPU, prêt à être dessiné. */
export interface LineSeries {
  /** Nombre de sommets envoyés : deux par segment. */
  readonly vertexCount: number
  /**
   * Dessine tous les segments avec `gl.LINES`, de la couleur donnée (RGB entre 0 et 1), placés par la
   * matrice de modèle (la rotation de l'objet pour ses aides, l'identité pour le monde).
   */
  draw: (model: Mat4, color: Vec3) => void
  /** Supprime le VAO et le buffer. Sans effet si déjà fait. */
  dispose: () => void
}

export interface LineRenderer {
  /** Matrice de vue des traits : doit être celle du programme de l'objet. */
  setView: (view: Mat4) => void
  /** Matrice de projection des traits : doit être celle du programme de l'objet. */
  setProjection: (projection: Mat4) => void
  /**
   * Envoie des segments au GPU. `positions` contient des PAIRES de points (6 flottants par segment).
   * Lève une erreur si l'envoi échoue (contexte perdu, mémoire GPU saturée, voir `throwIfGlError`) ;
   * rien ne reste alors alloué.
   */
  createSeries: (positions: Float32Array) => LineSeries
  /** Supprime les séries encore vivantes puis le programme. */
  dispose: () => void
}

/**
 * Compile le programme des lignes. Lève une erreur lisible (avec le journal du compilateur) si les
 * shaders sont refusés ; rien ne reste alors alloué.
 */
export function createLineRenderer(gl: WebGL2RenderingContext): LineRenderer {
  const program = createProgram(gl, vertexSource, fragmentSource)
  let uniforms: Record<UniformName, WebGLUniformLocation>
  try {
    uniforms = findUniforms(gl, program, UNIFORM_NAMES)
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  }

  // Les séries encore vivantes : `dispose` du renderer les libère toutes, même si l'appelant en a oublié.
  const liveSeries = new Set<LineSeries>()

  return {
    // `useProgram` avant chaque envoi : un uniform va au programme ACTIF, et c'est le programme de
    // l'objet qui l'est le plus souvent.
    setView(view) {
      gl.useProgram(program)
      gl.uniformMatrix4fv(uniforms.uView, false, view)
    },

    setProjection(projection) {
      gl.useProgram(program)
      gl.uniformMatrix4fv(uniforms.uProjection, false, projection)
    },

    createSeries(positions) {
      // Une paire de points = 6 flottants. Une série vide ou coupée au milieu d'un segment ne dessinerait
      // rien (ou un segment faux) sans aucune erreur de WebGL : on le dit tout de suite.
      if (positions.length === 0 || positions.length % 6 !== 0) {
        throw new RangeError(
          `Une série de lignes doit contenir des paires de points (6 valeurs par segment) : ${positions.length} valeurs reçues.`,
        )
      }

      // Comme pour un maillage (createIndexedMesh) : on vide d'abord les erreurs en attente pour ne pas
      // accuser cette série à tort, puis on lit `getError` après la copie, car un `bufferData` sans
      // mémoire GPU ne lève aucune exception.
      drainGlErrors(gl)

      const vao = createVertexArray(gl)
      let buffer: WebGLBuffer | null = null
      const release = () => {
        if (buffer) gl.deleteBuffer(buffer)
        gl.deleteVertexArray(vao)
      }

      try {
        gl.bindVertexArray(vao) // ce qui suit est enregistré DANS le VAO
        buffer = createBuffer(gl, gl.ARRAY_BUFFER, positions)
        gl.enableVertexAttribArray(POSITION_LOCATION)
        gl.vertexAttribPointer(POSITION_LOCATION, 3, gl.FLOAT, false, 0, 0)
        throwIfGlError(gl)
        gl.bindVertexArray(null)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
      } catch (error) {
        release()
        throw error
      }

      const vertexCount = positions.length / 3
      let disposed = false
      const series: LineSeries = {
        vertexCount,
        draw(model, color) {
          gl.useProgram(program)
          gl.uniformMatrix4fv(uniforms.uModel, false, model)
          gl.uniform3fv(uniforms.uColor, color)
          gl.bindVertexArray(vao)
          gl.drawArrays(gl.LINES, 0, vertexCount) // pas d'indices : les points sont déjà par paires
          gl.bindVertexArray(null)
        },
        dispose() {
          if (disposed) return
          disposed = true
          release()
          liveSeries.delete(series)
        },
      }
      liveSeries.add(series)
      return series
    },

    dispose() {
      for (const series of [...liveSeries]) series.dispose()
      // Supprime aussi les shaders encore attachés (voir createProgram).
      gl.deleteProgram(program)
    },
  }
}
