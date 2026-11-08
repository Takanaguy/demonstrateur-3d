import { render, screen } from '@testing-library/react'
import App from '../App'
import { Viewer3D } from './Viewer3D'

// jsdom n'a pas de WebGL : `getContext` renvoie null (et affiche « not implemented » dans la
// console). On le remplace par un null silencieux pour garder la sortie des tests propre, sans
// changer le comportement testé : c'est bien la vraie détection qui conclut « indisponible ».
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Viewer3D sans WebGL', () => {
  it('affiche un message clair en français au lieu de planter', () => {
    render(<Viewer3D />)

    expect(screen.getByRole('status')).toHaveTextContent(/La 3D n'est pas disponible/)
  })

  it("n'affiche pas de canvas quand la 3D est indisponible", () => {
    const { container } = render(<Viewer3D />)

    expect(container.querySelector('canvas')).toBeNull()
  })

  it("la page d'accueil reste utilisable : titre présent et message à la place de la 3D", () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Démonstrateur 3D' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
