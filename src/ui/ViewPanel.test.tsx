import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../core/viewOptions'
import { ViewPanel } from './ViewPanel'

/** Monte le panneau avec des options (par défaut + changements) et renvoie les fonctions espionnes. */
function setup(changes: Partial<ViewOptions> = {}, error?: string | null) {
  const onChange = vi.fn()
  const onResetCamera = vi.fn()
  const options: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, ...changes }
  const view = render(<ViewPanel options={options} onChange={onChange} onResetCamera={onResetCamera} error={error} />)
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

describe('ViewPanel : mode d\'affichage', () => {
  const group = () => screen.getByRole('group', { name: 'Affichage' })

  it('un groupe nommé « Affichage » avec trois choix : Plein, Fil de fer, Plein et fil de fer', () => {
    setup()

    const labels = within(group())
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('value'))
    expect(labels).toEqual(['solid', 'wireframe', 'solid-wireframe'])
    expect(within(group()).getByRole('radio', { name: 'Plein' })).toBeInTheDocument()
    expect(within(group()).getByRole('radio', { name: 'Fil de fer' })).toBeInTheDocument()
    expect(within(group()).getByRole('radio', { name: 'Plein et fil de fer' })).toBeInTheDocument()
  })

  it('au départ : « Plein » est coché, et lui seul', () => {
    setup()

    expect(screen.getByRole('radio', { name: 'Plein' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Fil de fer' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Plein et fil de fer' })).not.toBeChecked()
  })

  it.each([
    ['wireframe', 'Fil de fer'],
    ['solid-wireframe', 'Plein et fil de fer'],
  ] as const)('reflète le mode reçu en prop (%s) : un seul choix coché', (displayMode, label) => {
    setup({ displayMode })

    expect(screen.getByRole('radio', { name: label })).toBeChecked()
    expect(within(group()).getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1)
  })

  it.each([
    ['Fil de fer', 'wireframe'],
    ['Plein et fil de fer', 'solid-wireframe'],
  ] as const)('choisir « %s » appelle onChange avec ce seul champ modifié', async (label, displayMode) => {
    const user = userEvent.setup()
    const { onChange, options } = setup({ autoRotate: false })

    await user.click(screen.getByRole('radio', { name: label }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...options, displayMode })
  })

  it('on change de mode aussi au clavier (flèche bas depuis « Plein »)', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    screen.getByRole('radio', { name: 'Plein' }).focus()

    await user.keyboard('{ArrowDown}')

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]![0].displayMode).toBe('wireframe')
  })

  it('explique le fil de fer (diagonales des faces, plafond, traits de 1 pixel) et relie l\'aide au groupe', () => {
    setup()

    expect(group()).toHaveAccessibleDescription(/arêtes de tous les triangles/)
    expect(group()).toHaveAccessibleDescription(/diagonales/)
    expect(group()).toHaveAccessibleDescription(/500\s000 triangles/)
    expect(group()).toHaveAccessibleDescription(/1 pixel/)
  })
})

describe('ViewPanel : aides (normales, boîte, grille, axes)', () => {
  const NORMALS = 'Normales des sommets'
  const BOX = 'Boîte englobante'
  const GRID = 'Grille'
  const AXES = 'Axes'

  it('un groupe « Aides » avec quatre cases, toutes décochées au départ', () => {
    setup()

    const group = screen.getByRole('group', { name: 'Aides' })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(4)
    for (const name of [NORMALS, BOX, GRID, AXES]) expect(screen.getByRole('checkbox', { name })).not.toBeChecked()
  })

  it('reflète les options reçues en prop', () => {
    setup({ showNormals: true, showBoundingBox: false, showGrid: true, showAxes: true })

    expect(screen.getByRole('checkbox', { name: NORMALS })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: BOX })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: GRID })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: AXES })).toBeChecked()
  })

  it.each([
    [NORMALS, 'showNormals'],
    [BOX, 'showBoundingBox'],
    [GRID, 'showGrid'],
    [AXES, 'showAxes'],
  ] as const)('cocher « %s » appelle onChange avec ce seul champ (%s) modifié', async (label, field) => {
    const user = userEvent.setup()
    const { onChange, options } = setup({ displayMode: 'wireframe' })

    await user.click(screen.getByRole('checkbox', { name: label }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...options, [field]: true })
  })

  it('décocher une aide cochée la remet à false', async () => {
    const user = userEvent.setup()
    const { onChange, options } = setup({ showGrid: true })

    await user.click(screen.getByRole('checkbox', { name: GRID }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...options, showGrid: false })
  })

  it('les normales : un segment par sommet, échantillonné au-delà de 4 000 sommets, lu avec la case', () => {
    setup()

    const checkbox = screen.getByRole('checkbox', { name: NORMALS })
    expect(checkbox).toHaveAccessibleDescription(/un segment par sommet/i)
    expect(checkbox).toHaveAccessibleDescription(/échantillonné au-delà de 4\s000 sommets/)
  })

  it('la grille et les axes disent qu\'ils sont fixes dans le monde, les axes donnent leurs couleurs', () => {
    setup()

    expect(screen.getByRole('checkbox', { name: GRID })).toHaveAccessibleDescription(/fixe dans le monde/)
    const axes = screen.getByRole('checkbox', { name: AXES })
    expect(axes).toHaveAccessibleDescription(/X en rouge, Y en vert, Z en bleu/)
    expect(axes).toHaveAccessibleDescription(/Fixes dans le monde/)
  })
})

describe('ViewPanel : erreur d\'une aide', () => {
  it('sans erreur : aucune alerte', () => {
    setup()

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('avec une erreur : une alerte (role="alert") affiche le message', () => {
    setup({}, "Le fil de fer n'a pas pu être affiché. L'affichage plein est conservé.")

    expect(screen.getByRole('alert')).toHaveTextContent("Le fil de fer n'a pas pu être affiché.")
  })

  it('une erreur null n\'affiche rien', () => {
    setup({}, null)
    expect(screen.queryByRole('alert')).toBeNull()
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
