import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
import { ViewPanel } from './ViewPanel'

/** Monte le panneau avec des options (par défaut + changements) et renvoie les fonctions espionnes. */
function setup(changes: Partial<ViewOptions> = {}) {
  const onChange = vi.fn()
  const onResetCamera = vi.fn()
  const options: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, ...changes }
  const view = render(<ViewPanel options={options} onChange={onChange} onResetCamera={onResetCamera} />)
  return { onChange, onResetCamera, options, ...view }
}

const AUTO_ROTATE = "Rotation automatique de l'objet"
const CULLING = 'Masquer les faces vues de dos (culling)'

describe('ViewPanel : cases à cocher', () => {
  it('au départ : rotation automatique cochée, culling décoché, chaque case avec un label accessible', () => {
    setup()

    expect(screen.getByRole('checkbox', { name: AUTO_ROTATE })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: CULLING })).not.toBeChecked()
  })

  it('reflète les options reçues en prop (composant contrôlé)', () => {
    setup({ autoRotate: false, backfaceCulling: true })

    expect(screen.getByRole('checkbox', { name: AUTO_ROTATE })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: CULLING })).toBeChecked()
  })

  it('décocher la rotation automatique appelle onChange avec ce seul champ modifié', async () => {
    const user = userEvent.setup()
    const { onChange, options } = setup({ backfaceCulling: true })

    await user.click(screen.getByRole('checkbox', { name: AUTO_ROTATE }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...options, autoRotate: false })
  })

  it('cocher le culling appelle onChange avec ce seul champ modifié', async () => {
    const user = userEvent.setup()
    const { onChange, options } = setup({ autoRotate: false })

    await user.click(screen.getByRole('checkbox', { name: CULLING }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...options, backfaceCulling: true })
  })

  it('ne modifie pas l\'objet d\'options reçu (de nouvelles options à chaque changement)', async () => {
    const user = userEvent.setup()
    const { onChange, options } = setup()

    await user.click(screen.getByRole('checkbox', { name: CULLING }))

    expect(onChange.mock.calls[0]![0]).not.toBe(options)
    expect(options).toEqual(DEFAULT_VIEW_OPTIONS)
  })

  it('une case se coche aussi au clavier (barre d\'espace)', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    screen.getByRole('checkbox', { name: CULLING }).focus()

    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].backfaceCulling).toBe(true)
  })
})

describe('ViewPanel : aide du culling', () => {
  it('prévient qu\'un fichier OBJ aux triangles à l\'envers devient invisible, et la relie à la case (aria-describedby)', () => {
    setup()

    const checkbox = screen.getByRole('checkbox', { name: CULLING })
    expect(checkbox).toHaveAccessibleDescription(/fichier OBJ/)
    expect(checkbox).toHaveAccessibleDescription(/mauvais sens/)
    expect(checkbox).toHaveAccessibleDescription(/invisible/)
  })
})

describe('ViewPanel : caméra', () => {
  it('« Réinitialiser la caméra » appelle onResetCamera, sans toucher aux options', async () => {
    const user = userEvent.setup()
    const { onChange, onResetCamera } = setup({ autoRotate: false, backfaceCulling: true })

    await user.click(screen.getByRole('button', { name: 'Réinitialiser la caméra' }))

    expect(onResetCamera).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rappelle les commandes : glisser, flèches, molette, + et -, et la limite du pincement', () => {
    setup()

    const help = screen.getByText(/glisser avec la souris/i)
    expect(help).toHaveTextContent(/flèches/)
    expect(help).toHaveTextContent(/molette/)
    expect(help).toHaveTextContent(/touches \+ et -/)
    expect(help).toHaveTextContent(/pincement/)
  })

  it('le panneau est une région nommée', () => {
    setup()

    expect(screen.getByRole('region', { name: 'Réglages de la vue' })).toBeInTheDocument()
  })
})

describe('ViewPanel : prefers-reduced-motion', () => {
  const MESSAGE = /Votre système demande moins de mouvement/

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sans matchMedia (jsdom par défaut) : pas de message, et aucune erreur", () => {
    expect(window.matchMedia).toBeUndefined()

    setup()

    expect(screen.queryByText(MESSAGE)).toBeNull()
  })

  it('réglage système normal : pas de message', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))

    setup()

    expect(screen.queryByText(MESSAGE)).toBeNull()
  })

  it('moins de mouvement demandé : explique que rien ne tourne même si la case est cochée, et relie le texte à la case', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion') }))

    setup({ autoRotate: true })

    expect(screen.getByText(MESSAGE)).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: "Rotation automatique de l'objet" })
    expect(checkbox).toBeChecked() // la case garde le choix de l'utilisateur
    expect(checkbox).toHaveAccessibleDescription(MESSAGE)
  })

  it('interroge bien la requête prefers-reduced-motion: reduce', () => {
    const matchMedia = vi.fn(() => ({ matches: false }))
    vi.stubGlobal('matchMedia', matchMedia)

    setup()

    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('suit un changement du réglage système pendant que la page est ouverte, et se désabonne au démontage', () => {
    const listeners = new Set<() => void>()
    const query = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    }
    vi.stubGlobal('matchMedia', () => query)
    const { unmount } = setup()
    expect(screen.queryByText(MESSAGE)).toBeNull()
    expect(query.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    query.matches = true
    act(() => listeners.forEach((listener) => listener()))
    expect(screen.getByText(MESSAGE)).toBeInTheDocument()

    query.matches = false
    act(() => listeners.forEach((listener) => listener()))
    expect(screen.queryByText(MESSAGE)).toBeNull()

    unmount()
    expect(listeners.size).toBe(0)
  })
})
