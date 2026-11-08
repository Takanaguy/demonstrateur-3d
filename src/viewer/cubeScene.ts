import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
} from 'three'

const BACKGROUND_COLOR = '#F7F4EE'
const CUBE_COLOR = '#2E5D7C'

export interface CubeScene {
  scene: Scene
  camera: PerspectiveCamera
  cube: Mesh
  /** Libère la mémoire GPU de la géométrie et du matériau (Three.js ne le fait pas tout seul). */
  dispose: () => void
}

/**
 * Construit la scène minimale : un cube, une lumière directionnelle, un peu de lumière ambiante
 * (sans elle, les faces à l'ombre seraient noires) et un fond uni. Aucune dépendance au DOM :
 * le renderer et le canvas sont gérés par le composant.
 */
export function createCubeScene(): CubeScene {
  const scene = new Scene()
  scene.background = new Color(BACKGROUND_COLOR)

  const geometry = new BoxGeometry(1.5, 1.5, 1.5)
  const material = new MeshStandardMaterial({ color: CUBE_COLOR })
  const cube = new Mesh(geometry, material)
  // Une légère inclinaison de départ : vu pile de face, un cube ressemble à un carré plat.
  cube.rotation.x = 0.4
  scene.add(cube)

  const sun = new DirectionalLight('#ffffff', 2.5)
  sun.position.set(3, 4, 5)
  scene.add(sun)
  scene.add(new AmbientLight('#ffffff', 0.6))

  // L'aspect (largeur / hauteur) est mis à jour par le composant dès que la taille est connue.
  const camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 0, 5)

  return {
    scene,
    camera,
    cube,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
