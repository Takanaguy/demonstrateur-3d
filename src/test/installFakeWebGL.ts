/**
 * Installe un faux WebGL2 dans jsdom pour monter le composant `Viewer3D` (ou toute l'application)
 * dans un test. Même principe que dans `Viewer3D.lifecycle.test.tsx`, en plus court : ici les
 * images d'animation ne sont jamais jouées (on teste l'envoi des maillages, pas la rotation).
 *
 * À appeler dans un `beforeEach`. Le test doit appeler `vi.unstubAllGlobals()` et
 * `vi.restoreAllMocks()` dans son `afterEach`.
 */

import { act } from '@testing-library/react'
import { createFakeGl, type FakeGl, type FakeGlOptions } from './fakeGl'

/** `fakeOptions` règle les pannes simulées des faux contextes (voir `FakeGlOptions`). */
export function installFakeWebGL(fakeOptions: Omit<FakeGlOptions, 'size'> = {}) {
  /** Un faux contexte par canvas, comme le navigateur (même canvas = même contexte). */
  const fakes = new WeakMap<HTMLCanvasElement, FakeGl>()
  /** Les faux contextes des canvas de la page (le canvas jetable de la détection n'y est pas). */
  const pageFakes: FakeGl[] = []

  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== 'webgl2') return null
    let fake = fakes.get(this)
    if (!fake) {
      fake = createFakeGl({ ...fakeOptions, size: this })
      fakes.set(this, fake)
      if (this.isConnected) pageFakes.push(fake)
    }
    return fake.gl
  } as never)

  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: false }))

  return {
    getContext,
    /** Le faux contexte du canvas de la page (le premier, s'il y en a plusieurs). */
    pageFake: () => {
      const fake = pageFakes[0]
      if (!fake) throw new Error('Aucun canvas de page n\'a obtenu de contexte.')
      return fake
    },
    /** Simule la perte puis la restauration du contexte, le GPU ayant tout détruit entre les deux. */
    loseAndRestoreContext(canvas: HTMLCanvasElement, fake: FakeGl) {
      act(() => {
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
      })
      fake.loseAllResources()
      act(() => {
        canvas.dispatchEvent(new Event('webglcontextrestored'))
      })
    },
  }
}

/** Les données des deux derniers buffers d'attributs envoyés : positions puis normales du maillage affiché. */
export function lastUploadedMesh(fake: FakeGl) {
  const [positions, normals] = fake.attributeBindings().slice(-2)
  return { positions: positions!.data, normals: normals!.data }
}
