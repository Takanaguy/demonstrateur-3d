import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_LIGHTING, type LightingSettings } from '../core/lighting'
import { LightingPanel } from './LightingPanel'

/** Monte le panneau avec des réglages (par défaut + changements) et renvoie la fonction espionne. */
function setup(changes: Partial<LightingSettings> = {}) {
  const onChange = vi.fn()
  const settings: LightingSettings = { ...DEFAULT_LIGHTING, ...changes }
  const view = render(<LightingPanel settings={settings} onChange={onChange} />)
  return { onChange, settings, ...view }
}

/** Le dernier objet passé à onChange. */
function lastChange(onChange: ReturnType<typeof vi.fn>): LightingSettings {
  return onChange.mock.calls.at(-1)![0] as LightingSettings
}

describe('LightingPanel : modèle', () => {
  it('propose les trois modèles dans un groupe nommé, Lambert coché au départ', () => {
    setup()

    const group = screen.getByRole('group', { name: "Modèle d'éclairage" })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['lambert', 'blinn-phong', 'gaussian'])
    expect(screen.getByRole('radio', { name: 'Lambert' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Blinn-Phong' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Gaussien' })).not.toBeChecked()
  })

  it('choisir un modèle appelle onChange avec ce modèle et le reste inchangé', async () => {
    const user = userEvent.setup()
    const { onChange, settings } = setup()

    await user.click(screen.getByRole('radio', { name: 'Blinn-Phong' }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(lastChange(onChange)).toEqual({ ...settings, model: 'blinn-phong' })
  })

  it('reflète le modèle reçu en prop (composant contrôlé)', () => {
    setup({ model: 'gaussian' })

    expect(screen.getByRole('radio', { name: 'Gaussien' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Lambert' })).not.toBeChecked()
  })
})

describe('LightingPanel : curseurs', () => {
  it('chaque curseur a un label accessible et les bornes de sa plage', () => {
    setup()

    const x = screen.getByLabelText('Position X')
    expect(x).toHaveAttribute('type', 'range')
    expect(x).toHaveAttribute('min', '-10')
    expect(x).toHaveAttribute('max', '10')
    expect(x).toHaveAttribute('step', '0.5')
    const ambient = screen.getByLabelText('Lumière ambiante')
    expect(ambient).toHaveAttribute('min', '0')
    expect(ambient).toHaveAttribute('max', '1')
  })

  it('affiche la valeur de chaque curseur en texte lisible, à la française', () => {
    setup({ position: [3.5, -2, 5], ambient: 0.35 })

    expect(screen.getByLabelText('Position X')).toHaveValue('3.5')
    expect(screen.getByLabelText('Position X')).toHaveAttribute('aria-valuetext', '3,5')
    expect(screen.getByText('3,5')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
    expect(screen.getByText('0,35')).toBeInTheDocument()
  })

  it.each([
    ['Position X', 0],
    ['Position Y', 1],
    ['Position Z', 2],
  ])('%s change seulement la coordonnée %i de la position', (label, axis) => {
    const { onChange, settings } = setup()

    fireEvent.change(screen.getByLabelText(label), { target: { value: '-7.5' } })

    const expected = [...settings.position]
    expected[axis] = -7.5
    expect(lastChange(onChange)).toEqual({ ...settings, position: expected })
  })

  it("le curseur de lumière ambiante envoie un nombre (pas du texte) dans le champ `ambient`", () => {
    const { onChange, settings } = setup()

    fireEvent.change(screen.getByLabelText('Lumière ambiante'), { target: { value: '0.8' } })

    expect(lastChange(onChange)).toEqual({ ...settings, ambient: 0.8 })
    expect(typeof lastChange(onChange).ambient).toBe('number')
  })

  it('ne modifie pas le tableau de position reçu (nouveaux réglages à chaque changement)', () => {
    const { onChange, settings } = setup()

    fireEvent.change(screen.getByLabelText('Position Y'), { target: { value: '9' } })

    expect(lastChange(onChange).position).not.toBe(settings.position)
    expect(settings.position).toEqual([3, 4, 5])
  })
})

describe('LightingPanel : contrôles selon le modèle', () => {
  const SPECULAR = 'Intensité du reflet'
  const SHININESS = 'Brillance'
  const MEAN = "Moyenne de l'angle"
  const STD_DEV = "Écart type de l'angle"

  it('Lambert : ni reflet, ni brillance, ni moyenne, ni écart type (retirés de la page, pas grisés)', () => {
    setup({ model: 'lambert' })

    for (const label of [SPECULAR, SHININESS, MEAN, STD_DEV]) expect(screen.queryByLabelText(label)).toBeNull()
    // Les contrôles communs restent.
    for (const label of ['Position X', 'Position Y', 'Position Z', 'Lumière ambiante', 'Couleur de la lumière']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('Blinn-Phong : intensité du reflet et brillance, pas de réglages gaussiens', () => {
    setup({ model: 'blinn-phong' })

    expect(screen.getByLabelText(SPECULAR)).toBeInTheDocument()
    expect(screen.getByLabelText(SHININESS)).toBeInTheDocument()
    expect(screen.queryByLabelText(MEAN)).toBeNull()
    expect(screen.queryByLabelText(STD_DEV)).toBeNull()
  })

  it('Gaussien : intensité du reflet, moyenne et écart type, pas de brillance', () => {
    setup({ model: 'gaussian' })

    expect(screen.getByLabelText(SPECULAR)).toBeInTheDocument()
    expect(screen.getByLabelText(MEAN)).toBeInTheDocument()
    expect(screen.getByLabelText(STD_DEV)).toBeInTheDocument()
    expect(screen.queryByLabelText(SHININESS)).toBeNull()
  })

  it('la brillance envoie un nombre dans `shininess`, dans sa plage de 1 à 256', () => {
    const { onChange, settings } = setup({ model: 'blinn-phong' })
    const slider = screen.getByLabelText(SHININESS)
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '256')

    fireEvent.change(slider, { target: { value: '128' } })

    expect(lastChange(onChange)).toEqual({ ...settings, shininess: 128 })
  })

  it("la moyenne et l'écart type gaussiens modifient chacun leur champ, et s'affichent en radians", () => {
    const { onChange, settings } = setup({ model: 'gaussian' })

    expect(screen.getByText('0 rad')).toBeInTheDocument()
    expect(screen.getByText('0,15 rad')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(MEAN), { target: { value: '0.3' } })
    expect(lastChange(onChange)).toEqual({ ...settings, gaussianMean: 0.3 })
    fireEvent.change(screen.getByLabelText(STD_DEV), { target: { value: '0.5' } })
    expect(lastChange(onChange)).toEqual({ ...settings, gaussianStdDev: 0.5 })
  })

  it("changer de modèle conserve les réglages des autres modèles (on peut y revenir)", async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ model: 'blinn-phong', shininess: 77 })

    await user.click(screen.getByRole('radio', { name: 'Gaussien' }))

    expect(lastChange(onChange).shininess).toBe(77)
  })
})

describe('LightingPanel : couleur et réinitialisation', () => {
  it('le champ couleur a un label et envoie la couleur choisie', () => {
    const { onChange, settings } = setup()
    const input = screen.getByLabelText('Couleur de la lumière')
    expect(input).toHaveAttribute('type', 'color')
    expect(input).toHaveValue('#ffffff')

    fireEvent.change(input, { target: { value: '#ff8800' } })

    expect(lastChange(onChange)).toEqual({ ...settings, color: '#ff8800' })
  })

  it('« Réinitialiser l\'éclairage » renvoie exactement les réglages par défaut', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ model: 'gaussian', position: [-9, 9, -9], color: '#123456', ambient: 0.9, gaussianMean: 0.4 })

    await user.click(screen.getByRole('button', { name: "Réinitialiser l'éclairage" }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(lastChange(onChange)).toEqual(DEFAULT_LIGHTING)
  })

  it('le panneau est une région nommée', () => {
    setup()

    expect(screen.getByRole('region', { name: "Réglages de l'éclairage" })).toBeInTheDocument()
  })
})
