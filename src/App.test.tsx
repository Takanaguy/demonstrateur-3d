import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { normalizeToUnitBox } from './core/mesh'
import { MAX_OBJ_TEXT_LENGTH } from './core/obj'
import { createShape, type ShapeId } from './core/shapes'
import { installFakeWebGL, lastUploadedMesh } from './test/installFakeWebGL'

// L'application complète est montée avec un faux WebGL2 : le vrai panneau, le vrai analyseur OBJ,
// le vrai Viewer3D et le vrai renderer, seul le GPU est simulé. On vérifie ce que reçoit le GPU.

let env: ReturnType<typeof installFakeWebGL>

beforeEach(() => {
  env = installFakeWebGL()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const TETRAHEDRON = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n'
const ONE_MESH_ALIVE = { shader: 0, program: 1, buffer: 3, vertexArray: 1 }

function objFile(text: string, name = 'test.obj') {
  return new File([text], name, { type: 'model/obj' })
}

function fileInput() {
  return screen.getByLabelText('Charger un fichier .obj') as HTMLInputElement
}

/** Ce que le GPU a reçu en dernier, comparé à la forme attendue (normalisée comme le fait le renderer). */
function expectGpuShows(shape: ShapeId) {
  const expected = normalizeToUnitBox(createShape(shape))
  expect(lastUploadedMesh(env.pageFake()).positions).toEqual(Array.from(expected.positions))
}

describe('App : panneau de choix', () => {
  it('au départ : un cube, ses statistiques, un champ fichier avec label, aucune alerte', () => {
    render(<App />)

    expect(screen.getByRole('radio', { name: 'Cube' })).toBeChecked()
    expect(screen.getByText('Sommets : 24')).toBeInTheDocument()
    expect(screen.getByText('Triangles : 12')).toBeInTheDocument()
    expect(fileInput()).toHaveAttribute('accept', '.obj')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Revenir au cube' })).toHaveAttribute('aria-disabled', 'true')
    expectGpuShows('cube')
  })

  it('propose les quatre formes dans un groupe nommé', () => {
    render(<App />)

    const group = screen.getByRole('group', { name: 'Forme' })
    const names = within(group).getAllByRole('radio').map((radio) => radio.getAttribute('value'))
    expect(names).toEqual(['cube', 'sphere', 'plane', 'cone'])
  })

  it.each([
    ['Sphère', 'sphere', 'Sommets : 1 225'],
    ['Plan', 'plane', 'Sommets : 4'],
    ['Cône', 'cone', 'Sommets : 146'],
  ] as const)('choisir « %s » envoie la bonne forme au GPU et met à jour les statistiques', async (label, shape, vertices) => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('radio', { name: label }))

    expectGpuShows(shape)
    expect(screen.getByRole('radio', { name: label })).toBeChecked()
    // Les espaces insécables du format français sont comparés comme des espaces ordinaires.
    expect(screen.getByText((text) => text.replace(/\s/g, ' ') === vertices.replace(/\s/g, ' '))).toBeInTheDocument()
  })

  it('changer de forme ne recrée ni le canvas, ni le contexte WebGL, ni le programme', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const canvas = container.querySelector('canvas')
    const contextRequests = env.getContext.mock.calls.length

    await user.click(screen.getByRole('radio', { name: 'Sphère' }))
    await user.click(screen.getByRole('radio', { name: 'Cône' }))

    expect(container.querySelector('canvas')).toBe(canvas)
    expect(env.getContext.mock.calls.length).toBe(contextRequests)
    expect(env.pageFake().mocks.createProgram).toHaveBeenCalledOnce()
    expect(env.pageFake().liveCounts()).toEqual(ONE_MESH_ALIVE)
  })

  it('la description du canvas annonce ce qui est affiché', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('radio', { name: 'Plan' }))

    expect(container.querySelector('canvas')).toHaveAccessibleName(/Plan/)
  })
})

describe('App : chargement d\'un fichier .obj', () => {
  it('un fichier valide est affiché, avec son nom et ses statistiques', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.upload(fileInput(), objFile(TETRAHEDRON, 'tetraedre.obj'))

    expect(await screen.findByText('fichier tetraedre.obj')).toBeInTheDocument()
    expect(screen.getByText('Sommets : 4')).toBeInTheDocument()
    expect(screen.getByText('Triangles : 4')).toBeInTheDocument()
    const sent = lastUploadedMesh(env.pageFake())
    expect(sent.positions).toHaveLength(4 * 3)
    // Envoyé normalisé : le tétraèdre de côté 1 est ramené à un cube de côté 2.
    expect(Math.max(...sent.positions)).toBeCloseTo(1, 5)
    expect(Math.min(...sent.positions)).toBeCloseTo(-1, 5)
    expect(screen.queryByRole('alert')).toBeNull()
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Revenir au cube' })).not.toHaveAttribute('aria-disabled')
  })

  it('un fichier invalide affiche une alerte avec le numéro de ligne et GARDE le maillage précédent', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('radio', { name: 'Sphère' }))
    const fake = env.pageFake()
    const vaoCreated = fake.mocks.createVertexArray.mock.calls.length

    await user.upload(fileInput(), objFile('v 0 0 0\nv 1 0 oups\nf 1 2 3\n'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ligne 2')
    expect(alert).toHaveTextContent(/Fichier refusé/)
    // Rien n'a changé : la sphère est toujours choisie, affichée, et le GPU n'a rien reçu.
    expect(screen.getByRole('radio', { name: 'Sphère' })).toBeChecked()
    expect(fake.mocks.createVertexArray.mock.calls.length).toBe(vaoCreated)
    expectGpuShows('sphere')
  })

  it('un fichier sans aucune face est refusé', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.upload(fileInput(), objFile('v 0 0 0\nv 1 0 0\n'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/aucune face/)
  })

  it('un fichier trop gros est refusé SANS être lu', async () => {
    const user = userEvent.setup()
    render(<App />)
    const big = objFile('v 0 0 0')
    Object.defineProperty(big, 'size', { value: MAX_OBJ_TEXT_LENGTH + 1 })
    const read = vi.spyOn(big, 'text')

    await user.upload(fileInput(), big)

    expect(await screen.findByRole('alert')).toHaveTextContent(/pèse 50,1 Mo, le maximum est 50,0 Mo/)
    expect(read).not.toHaveBeenCalled()
    expectGpuShows('cube')
  })

  it('un fichier illisible reçoit un message clair, le maillage précédent reste', async () => {
    const user = userEvent.setup()
    render(<App />)
    const broken = objFile(TETRAHEDRON, 'casse.obj')
    vi.spyOn(broken, 'text').mockRejectedValue(new Error('lecture impossible'))

    await user.upload(fileInput(), broken)

    expect(await screen.findByRole('alert')).toHaveTextContent('« casse.obj » n\'a pas pu être lu')
    expectGpuShows('cube')
  })

  it('l\'alerte disparaît quand on choisit ensuite une forme valide', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(fileInput(), objFile('f 1 2 3'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Plan' }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('l\'ancienne alerte disparaît dès le début de la lecture d\'un nouveau fichier', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(fileInput(), objFile('f 1 2 3', 'mauvais.obj'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    let finishReading: (text: string) => void = () => {}
    const slow = objFile(TETRAHEDRON, 'lent.obj')
    vi.spyOn(slow, 'text').mockReturnValue(new Promise<string>((resolve) => (finishReading = resolve)))

    await user.upload(fileInput(), slow)

    // La lecture n'est pas terminée, mais l'alerte du fichier précédent n'est plus affichée.
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => finishReading(TETRAHEDRON))
    expect(await screen.findByText('fichier lent.obj')).toBeInTheDocument()
  })

  it('un fichier trop gros remplace l\'ancienne alerte par la nouvelle', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(fileInput(), objFile('f 1 2 3', 'mauvais.obj'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ligne 1')
    const big = objFile('v 0 0 0', 'gros.obj')
    Object.defineProperty(big, 'size', { value: MAX_OBJ_TEXT_LENGTH + 1 })

    await user.upload(fileInput(), big)

    expect(await screen.findByRole('alert')).toHaveTextContent(/gros\.obj/)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('le bouton « Revenir au cube » ramène le cube après un fichier', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(fileInput(), objFile(TETRAHEDRON))
    await screen.findByText('Sommets : 4')

    await user.click(screen.getByRole('button', { name: 'Revenir au cube' }))

    expect(screen.getByRole('radio', { name: 'Cube' })).toBeChecked()
    expect(screen.getByText('Sommets : 24')).toBeInTheDocument()
    expectGpuShows('cube')
    expect(screen.getByRole('button', { name: 'Revenir au cube' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('« Revenir au cube » garde le focus clavier après activation, et un clic sur le cube déjà affiché ne fait rien', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.upload(fileInput(), objFile(TETRAHEDRON))
    await screen.findByText('Sommets : 4')
    const button = screen.getByRole('button', { name: 'Revenir au cube' })
    button.focus()

    await user.keyboard('{Enter}')

    expect(screen.getByRole('radio', { name: 'Cube' })).toBeChecked()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus() // avec `disabled`, le focus serait perdu ici
    const vaoCreated = env.pageFake().mocks.createVertexArray.mock.calls.length
    await user.keyboard('{Enter}')
    await user.click(button)
    expect(env.pageFake().mocks.createVertexArray.mock.calls.length).toBe(vaoCreated) // rien renvoyé au GPU
    expect(button).toHaveFocus()
  })

  it('on peut recharger le même fichier : le champ est vidé après chaque choix', async () => {
    const user = userEvent.setup()
    render(<App />)
    const file = objFile(TETRAHEDRON, 'meme.obj')

    await user.upload(fileInput(), file)
    await screen.findByText('fichier meme.obj')
    expect(fileInput().value).toBe('')
    await user.click(screen.getByRole('radio', { name: 'Plan' }))
    await user.upload(fileInput(), file) // même fichier, deuxième fois

    expect(await screen.findByText('fichier meme.obj')).toBeInTheDocument()
    expect(screen.getByText('Sommets : 4')).toBeInTheDocument()
  })

  it('un fichier lent ne remplace pas un choix plus récent (résultat périmé ignoré)', async () => {
    const user = userEvent.setup()
    render(<App />)
    let finishReading: (text: string) => void = () => {}
    const slow = objFile(TETRAHEDRON, 'lent.obj')
    vi.spyOn(slow, 'text').mockReturnValue(new Promise<string>((resolve) => (finishReading = resolve)))

    await user.upload(fileInput(), slow)
    await user.click(screen.getByRole('radio', { name: 'Cône' })) // l'utilisateur change d'avis pendant la lecture
    await act(async () => finishReading(TETRAHEDRON))

    expect(screen.getByRole('radio', { name: 'Cône' })).toBeChecked()
    expect(screen.queryByText('fichier lent.obj')).toBeNull()
    expectGpuShows('cone')
  })

  it('si le GPU refuse le nouveau maillage : alerte, et retour à la sélection précédente', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<App />)
    env.pageFake().mocks.createBuffer.mockReturnValue(null)

    await user.click(screen.getByRole('radio', { name: 'Sphère' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/n'a pas pu être affiché/)
    expect(screen.getByRole('radio', { name: 'Cube' })).toBeChecked()
    expect(screen.getByText('Sommets : 24')).toBeInTheDocument()
  })
})

describe('App : perte de contexte', () => {
  it('après perte et restauration, le DERNIER maillage choisi revient (ici un fichier, pas le cube)', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.upload(fileInput(), objFile(TETRAHEDRON))
    await screen.findByText('Sommets : 4')
    const fake = env.pageFake()

    env.loseAndRestoreContext(container.querySelector('canvas')!, fake)

    expect(fake.liveCounts()).toEqual(ONE_MESH_ALIVE)
    expect(lastUploadedMesh(fake).positions).toHaveLength(4 * 3)
  })
})
