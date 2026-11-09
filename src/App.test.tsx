import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
    // Aucune FORME n'est cochée (les radios du modèle d'éclairage, eux, restent cochés).
    for (const radio of within(screen.getByRole('group', { name: 'Forme' })).getAllByRole('radio')) expect(radio).not.toBeChecked()
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

describe('App : éclairage', () => {
  it('au départ : le panneau est là, en Lambert, et le GPU a reçu les réglages par défaut', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: "Réglages de l'éclairage" })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Lambert' })).toBeChecked()
    expect(env.pageFake().lastUniform('uLightingModel')).toEqual([0])
    expect(env.pageFake().lastUniform('uLightPosition')).toEqual([3, 4, 5])
  })

  it('choisir Blinn-Phong envoie le modèle au GPU et fait apparaître la brillance', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('radio', { name: 'Blinn-Phong' }))

    expect(env.pageFake().lastUniform('uLightingModel')).toEqual([1])
    expect(screen.getByLabelText('Brillance')).toBeInTheDocument()
  })

  it('bouger un curseur de position envoie la nouvelle position au GPU', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '-6' } })

    expect(env.pageFake().lastUniform('uLightPosition')).toEqual([-6, 4, 5])
  })

  it("changer l'éclairage ne recrée ni le canvas, ni le contexte, ni le programme, ni le maillage", async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const canvas = container.querySelector('canvas')
    const contextRequests = env.getContext.mock.calls.length

    await user.click(screen.getByRole('radio', { name: 'Gaussien' }))
    fireEvent.change(screen.getByLabelText('Position Z'), { target: { value: '8' } })

    expect(container.querySelector('canvas')).toBe(canvas)
    expect(env.getContext.mock.calls.length).toBe(contextRequests)
    expect(env.pageFake().mocks.createProgram).toHaveBeenCalledOnce()
    expect(env.pageFake().mocks.createVertexArray).toHaveBeenCalledOnce()
  })

  it('« Réinitialiser l\'éclairage » remet les réglages par défaut à l\'écran ET sur le GPU', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('radio', { name: 'Gaussien' }))
    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '-6' } })

    await user.click(screen.getByRole('button', { name: "Réinitialiser l'éclairage" }))

    expect(screen.getByRole('radio', { name: 'Lambert' })).toBeChecked()
    expect(screen.getByLabelText('Position X')).toHaveValue('3')
    expect(env.pageFake().lastUniform('uLightingModel')).toEqual([0])
    expect(env.pageFake().lastUniform('uLightPosition')).toEqual([3, 4, 5])
  })

  it('changer de forme garde les réglages d\'éclairage choisis', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('radio', { name: 'Blinn-Phong' }))

    await user.click(screen.getByRole('radio', { name: 'Sphère' }))

    expect(screen.getByRole('radio', { name: 'Blinn-Phong' })).toBeChecked()
    expect(env.pageFake().lastUniform('uLightingModel')).toEqual([1])
  })

  it('après une perte de contexte, les DERNIERS réglages d\'éclairage reviennent', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(screen.getByRole('radio', { name: 'Gaussien' }))
    fireEvent.change(screen.getByLabelText('Position Y'), { target: { value: '-3' } })
    const fake = env.pageFake()

    env.loseAndRestoreContext(container.querySelector('canvas')!, fake)

    expect(fake.lastUniform('uLightingModel')).toEqual([2])
    expect(fake.lastUniform('uLightPosition')).toEqual([3, -3, 5])
  })
})

describe('App : vue et caméra', () => {
  const AUTO_ROTATE = "Rotation automatique de l'objet"
  const CULLING = 'Masquer les faces vues de dos (culling)'

  it('affiche les trois panneaux (maillage, éclairage, vue) avec leurs réglages', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: "Choix de l'objet affiché" })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: "Réglages de l'éclairage" })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Réglages de la vue' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: AUTO_ROTATE })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: CULLING })).not.toBeChecked()
  })

  it('la 3D est placée AVANT les panneaux dans la page, et collée en haut sur petit écran (sticky jusqu\'à md)', () => {
    const { container } = render(<App />)
    const canvas = container.querySelector('canvas')!

    for (const name of ["Choix de l'objet affiché", "Réglages de l'éclairage", 'Réglages de la vue']) {
      const panel = screen.getByRole('region', { name })
      // DOCUMENT_POSITION_FOLLOWING : le panneau vient APRÈS le canvas dans le document.
      expect(canvas.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING, name).toBeTruthy()
    }
    expect(canvas.parentElement).toHaveClass('sticky', 'top-0', 'z-10', 'md:static')
  })

  it('le canvas annonce ce qui est affiché sans promettre une rotation (elle peut être coupée)', () => {
    const { container } = render(<App />)

    const canvas = container.querySelector('canvas')!
    expect(canvas).toHaveAccessibleName(/Objet affiché en 3D : Cube/)
    expect(canvas).not.toHaveAccessibleName(/tourne/)
  })

  it('décocher la rotation automatique arrête la rotation de l\'objet', async () => {
    const user = userEvent.setup()
    render(<App />)
    env.runFrame(0)
    env.runFrame(50)
    const rotating = env.pageFake().lastUniform('uModel')
    env.runFrame(100)
    expect(env.pageFake().lastUniform('uModel')).not.toEqual(rotating) // elle tourne au départ

    await user.click(screen.getByRole('checkbox', { name: AUTO_ROTATE }))
    env.runFrame(150)
    const stopped = env.pageFake().lastUniform('uModel')
    env.runFrame(200)
    env.runFrame(250)

    expect(env.pageFake().lastUniform('uModel')).toEqual(stopped)
  })

  it('cocher le culling l\'active sur le GPU (faces BACK), le décocher le désactive', async () => {
    const user = userEvent.setup()
    render(<App />)
    const fake = env.pageFake()
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: CULLING }))
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)
    expect(fake.cullFaceMode()).toBe(fake.gl.BACK)

    await user.click(screen.getByRole('checkbox', { name: CULLING }))
    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(false)
  })

  it('changer les options de vue ne recrée ni le canvas, ni le contexte, ni le programme, ni le maillage', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const canvas = container.querySelector('canvas')
    const contextRequests = env.getContext.mock.calls.length

    await user.click(screen.getByRole('checkbox', { name: CULLING }))
    await user.click(screen.getByRole('checkbox', { name: AUTO_ROTATE }))

    expect(container.querySelector('canvas')).toBe(canvas)
    expect(env.getContext.mock.calls.length).toBe(contextRequests)
    expect(env.pageFake().mocks.createProgram).toHaveBeenCalledOnce()
    expect(env.pageFake().mocks.createVertexArray).toHaveBeenCalledOnce()
  })

  it('« Réinitialiser la caméra » remet la caméra de départ sur le GPU après un déplacement', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const fake = env.pageFake()
    const canvas = container.querySelector('canvas')!
    env.runFrame(0)
    const start = fake.lastUniform('uCameraPosition')

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    fireEvent.keyDown(canvas, { key: '-' })
    env.runFrame(16)
    expect(fake.lastUniform('uCameraPosition')).not.toEqual(start)

    await user.click(screen.getByRole('button', { name: 'Réinitialiser la caméra' }))
    env.runFrame(32)

    expect(fake.lastUniform('uCameraPosition')).toEqual(start)
  })

  it('« Réinitialiser la caméra » peut servir plusieurs fois de suite (chaque clic change la clé)', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const fake = env.pageFake()
    const canvas = container.querySelector('canvas')!
    env.runFrame(0)
    const start = fake.lastUniform('uCameraPosition')
    const reset = screen.getByRole('button', { name: 'Réinitialiser la caméra' })

    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(canvas, { key: 'ArrowRight' })
      await user.click(reset)
      env.runFrame(16 * (i + 1))
      expect(fake.lastUniform('uCameraPosition'), `tour ${i + 1}`).toEqual(start)
    }
  })

  it('« Réinitialiser la caméra » ne change pas les options de vue', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('checkbox', { name: CULLING }))

    await user.click(screen.getByRole('button', { name: 'Réinitialiser la caméra' }))

    expect(screen.getByRole('checkbox', { name: CULLING })).toBeChecked()
    expect(env.pageFake().isEnabled(env.pageFake().gl.CULL_FACE)).toBe(true)
  })

  it('changer de forme garde les options de vue choisies', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('checkbox', { name: CULLING }))

    await user.click(screen.getByRole('radio', { name: 'Sphère' }))

    expect(screen.getByRole('checkbox', { name: CULLING })).toBeChecked()
    expect(env.pageFake().isEnabled(env.pageFake().gl.CULL_FACE)).toBe(true)
  })

  it('après une perte de contexte, les options de vue ET la caméra courantes reviennent', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const canvas = container.querySelector('canvas')!
    const fake = env.pageFake()
    await user.click(screen.getByRole('checkbox', { name: CULLING }))
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    env.runFrame(0)
    const cameraBefore = fake.lastUniform('uCameraPosition')

    env.loseAndRestoreContext(canvas, fake)

    expect(fake.isEnabled(fake.gl.CULL_FACE)).toBe(true)
    expect(fake.lastUniform('uCameraPosition')).toEqual(cameraBefore)
  })
})

describe('App : taille de la 3D collée', () => {
  it('plafonne la hauteur de la 3D sous md (45vh) sans toucher à sa largeur, et retire le plafond à partir de md', () => {
    const { container } = render(<App />)

    // Test sur la présence des classes : jsdom ne charge pas le CSS Tailwind, il ne peut pas mesurer
    // la hauteur réelle (paysage téléphone à vérifier dans un vrai navigateur).
    expect(container.querySelector('canvas')).toHaveClass('aspect-video', 'w-full', 'max-h-[45vh]', 'md:max-h-none')
  })
})
