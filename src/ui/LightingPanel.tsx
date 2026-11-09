import { useId } from 'react'
import {
  AMBIENT_RANGE,
  DEFAULT_LIGHTING,
  GAUSSIAN_MEAN_RANGE,
  GAUSSIAN_STD_DEV_RANGE,
  POSITION_RANGE,
  SHININESS_RANGE,
  SPECULAR_RANGE,
  LIGHTING_MODELS,
  type LightingModel,
  type LightingRange,
  type LightingSettings,
} from '../core/lighting'

interface LightingPanelProps {
  settings: LightingSettings
  onChange: (settings: LightingSettings) => void
}

/** Le nom de chaque modèle tel qu'il est écrit dans l'interface. */
const MODEL_LABELS: Record<LightingModel, string> = {
  lambert: 'Lambert',
  'blinn-phong': 'Blinn-Phong',
  gaussian: 'Gaussien',
}

const BUTTON_CLASSES =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50'

/** Nombres écrits à la française (virgule), deux décimales au plus : « 3,5 », « 0,35 ». */
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

interface SliderProps {
  label: string
  value: number
  range: LightingRange
  /** Texte ajouté après la valeur affichée, par exemple « rad ». */
  unit?: string
  onChange: (value: number) => void
}

/**
 * Un curseur avec son étiquette et sa valeur affichée. Le `<label>` est relié au curseur (`htmlFor`),
 * ce qui le rend accessible au clavier et aux lecteurs d'écran. `aria-valuetext` donne la valeur
 * telle qu'on la lit (« 0,15 rad »), plus parlante que le nombre brut.
 */
function Slider({ label, value, range, unit, onChange }: SliderProps) {
  const id = useId()
  const text = unit ? `${numberFormat.format(value)} ${unit}` : numberFormat.format(value)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <label htmlFor={id} className="font-medium text-slate-800">
          {label}
        </label>
        {/* Un <span> et non un <output> : <output> est une zone « status » (le lecteur d'écran annoncerait
            chaque valeur à chaque mouvement) et se confondrait avec le message de repli de la 3D. La valeur
            est déjà lue par aria-valuetext sur le curseur. */}
        <span className="tabular-nums text-slate-600">{text}</span>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

/**
 * Le panneau d'éclairage : modèle, position et couleur de la lumière, ambiant, reflet. Il est
 * contrôlé : il affiche `settings` et prévient `App` par `onChange` avec de NOUVEAUX réglages
 * (jamais de modification sur place). Les contrôles inutiles pour le modèle choisi sont retirés
 * de la page, pas seulement grisés : un curseur sans effet ne ferait que désorienter.
 */
export function LightingPanel({ settings, onChange }: LightingPanelProps) {
  const colorId = useId()
  const hasSpecular = settings.model !== 'lambert'
  const update = (changes: Partial<LightingSettings>) => onChange({ ...settings, ...changes })
  const updatePosition = (axis: 0 | 1 | 2, value: number) => {
    const position = [...settings.position] as [number, number, number]
    position[axis] = value
    update({ position })
  }

  return (
    <section aria-label="Réglages de l'éclairage" className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Modèle d'éclairage</legend>
        {LIGHTING_MODELS.map((model) => (
          <label key={model} className="flex items-center gap-1.5 text-slate-800">
            <input
              type="radio"
              name="lighting-model"
              value={model}
              checked={settings.model === model}
              onChange={() => update({ model })}
            />
            {MODEL_LABELS[model]}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Position de la lumière</legend>
        <Slider label="Position X" value={settings.position[0]} range={POSITION_RANGE} onChange={(v) => updatePosition(0, v)} />
        <Slider label="Position Y" value={settings.position[1]} range={POSITION_RANGE} onChange={(v) => updatePosition(1, v)} />
        <Slider label="Position Z" value={settings.position[2]} range={POSITION_RANGE} onChange={(v) => updatePosition(2, v)} />
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={colorId} className="text-sm font-semibold text-slate-900">
          Couleur de la lumière
        </label>
        <input
          id={colorId}
          type="color"
          // Un champ couleur donne toujours sa valeur en minuscules : on lui parle dans le même format.
          value={settings.color.toLowerCase()}
          className="h-9 w-16 cursor-pointer rounded border border-slate-300 bg-white"
          onChange={(event) => update({ color: event.target.value })}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Intensités</legend>
        <Slider label="Lumière ambiante" value={settings.ambient} range={AMBIENT_RANGE} onChange={(v) => update({ ambient: v })} />
        {hasSpecular && (
          <Slider label="Intensité du reflet" value={settings.specular} range={SPECULAR_RANGE} onChange={(v) => update({ specular: v })} />
        )}
        {settings.model === 'blinn-phong' && (
          <Slider label="Brillance" value={settings.shininess} range={SHININESS_RANGE} onChange={(v) => update({ shininess: v })} />
        )}
        {settings.model === 'gaussian' && (
          <>
            <Slider
              label="Moyenne de l'angle"
              value={settings.gaussianMean}
              range={GAUSSIAN_MEAN_RANGE}
              unit="rad"
              onChange={(v) => update({ gaussianMean: v })}
            />
            <Slider
              label="Écart type de l'angle"
              value={settings.gaussianStdDev}
              range={GAUSSIAN_STD_DEV_RANGE}
              unit="rad"
              onChange={(v) => update({ gaussianStdDev: v })}
            />
          </>
        )}
      </fieldset>

      <div>
        <button type="button" className={BUTTON_CLASSES} onClick={() => onChange(DEFAULT_LIGHTING)}>
          Réinitialiser l'éclairage
        </button>
      </div>
    </section>
  )
}
