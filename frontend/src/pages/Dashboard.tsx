/**
 * Dashboard: status cards, 5-day outlook, ward map, actions, hourly chart. The "View as" switch in
 * the header (?role=, lib/roles.ts) chooses which data each audience sees; the layout is the same in
 * every view. Every value comes from the backend:
 *
 *   status cards / outlook   GET /alerts/triggers (the official AMC level and the city max
 *                            temperature it was decided on), GET /risk/zones (HeatLens heat stress
 *                            per ward, mortality risk), GET /forecast/{city}/hourly (feels-like,
 *                            min, peak heat hours, WBGT by hour)
 *   map                      ZoneRisk.surface_temperature (measured ground heat per ward)
 *   actions                  Heat Action Plan actions for the AMC level, HeatLens suggestions
 *                            (advisory rules) labelled as such, or resident tips (lib/advice.ts)
 *   chart                    hourly UTCI, or hourly WBGT for outdoor workers
 *
 * Two signals are always named apart: the official AMC alert, and HeatLens heat stress.
 *
 * "?mode=history&date=YYYY-MM-DD" replays a past day (the 2010 heatwave demo) through the same
 * components; the header says so.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, CalendarClock, Clock, HardHat, HeartPulse, Moon, ShieldAlert, ShieldCheck, Thermometer } from 'lucide-react'
import {
  DEFAULT_CITY,
  useAdvisory,
  useCityZonesGeoJSON,
  useForecast,
  useHourlyMany,
  useRiskZonesMany,
  useTriggersMany,
  type HourlyResponse,
  type ZoneRisk,
} from '../api/hooks'
import { DEMO_DATE } from '../lib/dates'
import { BAND_ACCENT, WBGT_REST_ONLY_C, addDays, hourLabel, restOnlyRun } from '../lib/dashboard'
import { AMC_LEVEL_NAME, HAP_COLOR, isHapLevel, outdoorWorkAdvice, type HapLevel } from '../lib/hap'
import { LEVEL_PLAIN, deathRisk, driverPlain } from '../lib/plain'
import { residentTips } from '../lib/advice'
import { isRole, rememberedRole, type Role } from '../lib/roles'
import { buildActions, type ActionRow } from '../lib/actions'
import StatusRow, { type StatusCard } from '../components/dashboard/StatusRow'
import FiveDayForecast from '../components/dashboard/FiveDayForecast'
import RiskMap from '../components/dashboard/RiskMap'
import RecommendedActions from '../components/dashboard/RecommendedActions'
import HeatExposureChart from '../components/dashboard/HeatExposureChart'
import { ErrorMessage } from '../components/layout/StateMessage'

const DASH = '—'
const deg = (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v)}°C`)
const range = (r: { start: number; end: number } | null, loaded: boolean) =>
  r ? `${hourLabel(r.start)} – ${hourLabel(r.end)}` : loaded ? 'None today' : DASH
const pctRise = (rr: number) => (rr <= 1 ? 'Normal' : `+${Math.round((rr - 1) * 100)}%`)

/** Soft background per official level, for the headline card. */
const LEVEL_TINT: Record<HapLevel, string> = { Green: '#F3FAF4', Yellow: '#FFFAEB', Orange: '#FFF4EC', Red: '#FEF0F0' }
const LEVEL_TEXT: Record<HapLevel, string> = { Green: '#15803D', Yellow: '#A16207', Orange: '#C2410C', Red: '#B91C1C' }

function peakZone(zones: ZoneRisk[] | undefined): ZoneRisk | null {
  if (!zones?.length) return null
  return zones.reduce((a, b) => (b.calibrated_score > a.calibrated_score ? b : a))
}

/** The ward the Heat Stress page lists first: highest score, then (among ties) the most people. */
function mostStressedWard(zones: ZoneRisk[] | undefined): ZoneRisk | null {
  if (!zones?.length) return null
  const key = (z: ZoneRisk) => [Math.round(z.calibrated_score), z.exposure.population_count ?? 0]
  return zones.reduce((a, b) => {
    const [sa, pa] = key(a)
    const [sb, pb] = key(b)
    return sb > sa || (sb === sa && pb > pa) ? b : a
  })
}

function wbgtPoints(h: HourlyResponse | undefined) {
  return (h?.points ?? []).filter((p) => p.wbgt_c != null).map((p) => ({ hour: p.hour, v: p.wbgt_c as number }))
}

function maxWbgt(h: HourlyResponse | undefined): number | null {
  const v = wbgtPoints(h).map((p) => p.v)
  return v.length ? Math.max(...v) : null
}

const TIER_WORDS: Record<string, string> = {
  heatwave: 'Heatwave',
  single_day_above_p97: 'Heatwave level (day 1)',
  below_threshold: 'No heatwave',
}

export default function Dashboard() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const role: Role = isRole(params.get('role')) ? (params.get('role') as Role) : rememberedRole()
  const replay = params.get('mode') === 'history'
  const forecast = useForecast(DEFAULT_CITY, 5)
  const today = replay ? (params.get('date') ?? DEMO_DATE) : (forecast.data?.issue_date ?? '')
  const dates = useMemo(() => (today ? [0, 1, 2, 3, 4].map((n) => addDays(today, n)) : []), [today])

  const geo = useCityZonesGeoJSON(DEFAULT_CITY)
  const zonesQ = useRiskZonesMany(DEFAULT_CITY, dates)
  const hourlyQ = useHourlyMany(DEFAULT_CITY, dates)
  const trigQ = useTriggersMany(DEFAULT_CITY, dates)
  const [chartDay, setChartDay] = useState<'today' | 'tomorrow'>('today')

  const todayZones = zonesQ[0]?.data?.zones ?? []
  // Advice and suggestions are read for the most stressed ward, as on the Heat Stress page.
  const firstZone = mostStressedWard(todayZones)?.zone_id ?? null
  const general = useAdvisory(firstZone, DEFAULT_CITY, today, 'general')
  const elderly = useAdvisory(firstZone, DEFAULT_CITY, today, 'elderly')
  const workers = useAdvisory(firstZone, DEFAULT_CITY, today, 'construction')

  // Heat stress is per ward (each has its own forecast cell on live dates). City-level cards show the
  // most affected ward's band and how many wards share it.
  const zonesOn = (i: number) => zonesQ[i]?.data?.zones
  const peak = (i: number) => peakZone(zonesOn(i))
  const band = (i: number) => peak(i)?.risk_band ?? null
  const bandWards = (i: number) => {
    const b = band(i)
    return b ? (zonesOn(i) ?? []).filter((z) => z.risk_band === b).length : null
  }
  const maxTa = (i: number) => trigQ[i]?.data?.city_ta_max_c ?? hourlyQ[i]?.data?.max_ta_c ?? null
  const cloud = (i: number) => hourlyQ[i]?.data?.daytime_cloud_cover_pct ?? null
  const levelOn = (i: number): HapLevel | null => {
    const raw = trigQ[i]?.data?.groups[0]?.level
    return raw && isHapLevel(raw) ? raw : null
  }
  const level = levelOn(0)
  const level1 = levelOn(1)
  const h0 = hourlyQ[0]?.data
  const h1 = hourlyQ[1]?.data
  const hap = trigQ[0]?.data?.groups[0]?.actions ?? []
  const link = firstZone ? `/advisory/${firstZone}?date=${today}` : '/advice'
  const openWard = (id: string) => navigate(`/zones/${id}?date=${today}`)
  const utciPeak =
    h0?.peak_start_hour != null && h0?.peak_end_hour != null ? { start: h0.peak_start_hour, end: h0.peak_end_hour } : null
  const stressed = todayZones.filter((z) => z.risk_band === 'High' || z.risk_band === 'Extreme')
  const mainDriver = (() => {
    const counts = todayZones.reduce<Record<string, number>>((m, z) => ({ ...m, [z.dominant_driver]: (m[z.dominant_driver] ?? 0) + 1 }), {})
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  })()

  // ------------------------------------------------------------------ shared cards
  const alertCard = (label: string): StatusCard => ({
    key: 'alert',
    headline: true,
    icon: level && level !== 'Green' ? <ShieldAlert /> : <ShieldCheck />,
    label,
    value: level ? LEVEL_PLAIN[level].headline : DASH,
    valueColor: level ? LEVEL_TEXT[level] : '#13265C',
    sub: level ? `${AMC_LEVEL_NAME[level].split(' – ')[0]} level · AMC Heat Action Plan` : undefined,
    bg: level ? LEVEL_TINT[level] : undefined,
    accent: level ? HAP_COLOR[level] : undefined,
    hint: `${trigQ[0]?.data?.level_basis ?? 'AMC Heat Action Plan 2019 alert level.'}`,
  })
  const stressCard: StatusCard = {
    key: 'stress',
    icon: <Activity />,
    label: 'Heat stress',
    value: band(0) ?? DASH,
    valueColor: band(0) ? BAND_ACCENT[band(0) as string] : '#13265C',
    sub: todayZones.length
      ? stressed.length
        ? `HeatLens · high in ${stressed.length} of ${todayZones.length} wards`
        : `HeatLens · below high in all ${todayZones.length} wards`
      : undefined,
    hint: 'HeatLens heat-stress score (0–100) in the most affected ward. It counts humidity, sun and hot nights as well as temperature, so it can be high on a day with no official alert.',
  }
  const feelsCard: StatusCard = {
    key: 'feels',
    icon: <Thermometer />,
    label: 'Feels like',
    value: deg(h0?.max_heat_index_c),
    sub: 'Heat index, in the shade',
    hint: "Today's highest NWS heat index: temperature and humidity together, in the shade.",
  }
  const maxCard: StatusCard = {
    key: 'maxmin',
    icon: <Thermometer />,
    label: 'Max temperature',
    value: deg(maxTa(0)),
    sub: `Low ${deg(h0?.min_ta_c)}`,
    hint: trigQ[0]?.data?.city_ta_max_source ? `Max: ${trigQ[0].data.city_ta_max_source}.` : undefined,
  }
  const peakCard: StatusCard = {
    key: 'peak',
    icon: <Clock />,
    label: 'Peak heat hours',
    value: range(utciPeak, h0 != null),
    sub: 'In the sun, UTCI 38 °C or more',
    hint: h0?.peak_rule ?? undefined,
  }
  const tomorrowCard: StatusCard = {
    key: 'tomorrow',
    icon: <CalendarClock />,
    label: 'Tomorrow',
    value: level1 ? LEVEL_PLAIN[level1].headline : DASH,
    valueColor: level1 && level1 !== 'Green' ? LEVEL_TEXT[level1] : '#13265C',
    sub: [band(1) && bandWards(1) != null ? `${band(1)} heat stress in ${bandWards(1)} wards` : null, `max ${deg(maxTa(1))}`]
      .filter(Boolean)
      .join(' · '),
    hint: 'Official AMC alert for tomorrow; below it, HeatLens heat stress in the most affected wards.',
  }

  // ------------------------------------------------------------------ per-role content
  let cards: StatusCard[]
  let actions: ActionRow[]
  let actionsTitle = 'City actions today'
  let actionsNote: string | undefined
  let showSource = true
  let mapWhich: 'day' | 'night' = 'day'
  let chartMetric: 'utci' | 'wbgt' = 'utci'

  if (role === 'people') {
    cards = [alertCard('Official alert today'), feelsCard, peakCard, maxCard, tomorrowCard]
    const tips = residentTips(level, 'en', utciPeak != null)
    const fixed: ActionRow[] = tips.map((t) => ({ key: t.key, kind: t.key, text: t.text, to: link, source: 'advice' }))
    const heatwave = buildActions([], [general.data, elderly.data], link, 10).filter((r) => r.kind === 'health_alert')
    actions = [...fixed, ...heatwave].slice(0, 5)
    actionsTitle = 'What you should do'
    actionsNote = level ? `For an AMC “${LEVEL_PLAIN[level].headline.toLowerCase()}” day.` : undefined
    showSource = false
  } else if (role === 'health') {
    const p0 = peak(0)
    const p1 = peak(1)
    cards = [
      {
        key: 'tier',
        headline: true,
        icon: <HeartPulse />,
        label: 'Heatwave status today',
        value: p0 ? (TIER_WORDS[p0.health.exposure_tier] ?? p0.health.exposure_tier) : DASH,
        valueColor: p0?.health.exposure_tier === 'heatwave' ? '#B91C1C' : '#13265C',
        sub:
          p0?.health.daily_mean_temp_c != null
            ? `Daily mean ${p0.health.daily_mean_temp_c.toFixed(1)}°C vs ${p0.health.threshold_p97_c.toFixed(1)}°C limit`
            : undefined,
        hint: 'Published Ahmedabad heatwave definition: 2+ days above the 97th percentile of daily mean temperature (de Bont et al. 2024).',
      },
      {
        key: 'rr',
        icon: <HeartPulse />,
        label: 'Risk of heat deaths',
        value: p0 ? pctRise(p0.health.relative_risk) : DASH,
        sub: 'vs a normal day',
        hint: deathRisk(p0?.health.relative_risk, p0?.health.exposure_tier).detail,
      },
      stressCard,
      { key: 'night', icon: <Moon />, label: 'Lowest tonight', value: deg(p0?.thermal.night_min_ta_c), sub: 'Hot nights slow recovery', hint: 'Night-time minimum air temperature. Bodies recover from heat at night.' },
      peakCard,
      {
        key: 'rr1',
        icon: <CalendarClock />,
        label: 'Tomorrow: heat deaths',
        value: p1 ? pctRise(p1.health.relative_risk) : DASH,
        sub: p1 ? (TIER_WORDS[p1.health.exposure_tier] ?? '') : undefined,
        hint: deathRisk(p1?.health.relative_risk, p1?.health.exposure_tier).detail,
      },
    ]
    // Health-department actions from the plan, then only the health-related advice (drinking water,
    // elderly check-ins, the heatwave mortality warning) - not municipal jobs like cooling centres.
    actions = buildActions(hap, [elderly.data, general.data], link, 10, ['health'])
      .filter((r) => hap.some((a) => a.kind === r.kind) || ['hydration', 'vulnerable_check', 'health_alert'].includes(r.kind))
      .slice(0, 5)
    actionsTitle = 'Health department actions'
    mapWhich = 'night'
  } else if (role === 'workers') {
    const w0 = maxWbgt(h0)
    const w1 = maxWbgt(h1)
    const hot = (w: number | null) => w != null && w >= WBGT_REST_ONLY_C
    cards = [
      {
        key: 'wbgt',
        headline: true,
        icon: <HardHat />,
        label: 'Work safety today (WBGT max)',
        value: w0 == null ? DASH : `${w0.toFixed(1)}°C`,
        valueColor: hot(w0) ? '#B91C1C' : '#13265C',
        sub: w0 == null ? undefined : hot(w0) ? 'Above 33 °C: rest only at peak' : 'Below the 33 °C rest-only level',
        hint: 'WBGT: heat + humidity + sun, the ISO 7243 work-safety index. 33 °C is the rest-only level used by the HeatLens physics module.',
      },
      { key: 'rest', icon: <Clock />, label: 'Rest-only hours', value: range(restOnlyRun(wbgtPoints(h0)), h0 != null), sub: 'WBGT 33 °C or more', hint: 'Hours with WBGT of 33 °C or more.' },
      {
        key: 'rule',
        icon: <HardHat />,
        label: 'Work rule today',
        value: level === 'Orange' || level === 'Red' ? 'No work 11 AM–4 PM' : 'No restriction',
        sub: level ? `AMC ${AMC_LEVEL_NAME[level]}` : undefined,
        hint: outdoorWorkAdvice(level).detail,
      },
      maxCard,
      feelsCard,
      {
        key: 'wbgt1',
        icon: <CalendarClock />,
        label: 'Tomorrow (WBGT max)',
        value: w1 == null ? DASH : `${w1.toFixed(1)}°C`,
        valueColor: hot(w1) ? '#B91C1C' : '#13265C',
        sub: `Max temperature ${deg(maxTa(1))}`,
      },
    ]
    actions = buildActions(hap, [workers.data], link, 5, ['labour'])
    actionsTitle = 'Work rules today'
    chartMetric = 'wbgt'
  } else {
    cards = [alertCard('Official alert today (AMC)'), stressCard, feelsCard, maxCard, peakCard, tomorrowCard]
    // The plan's actions for today's level, then HeatLens's own city suggestions - labelled, never
    // presented as the plan. Personal advice is left to the residents' view.
    actions = buildActions(hap, [general.data, elderly.data], link, 6).filter((r) => r.source !== 'advice').slice(0, 5)
    const stressedNoAlert = level === 'Green' && stressed.length > 0
    actionsNote = stressedNoAlert
      ? `No official alert, but heat stress is high in ${stressed.length} wards${
          mainDriver ? ` (${driverPlain(mainDriver).toLowerCase()})` : ''
        }. The AMC plan asks for no measures at this level; HeatLens suggests the steps below.`
      : level
        ? `AMC Heat Action Plan measures for a ${AMC_LEVEL_NAME[level].split(' – ')[0]} day.`
        : undefined
  }

  if (!replay && forecast.error) {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <ErrorMessage error={forecast.error} title="Could not load the live forecast." onRetry={() => forecast.refetch()} />
        <button
          onClick={() => navigate(`/?mode=history&date=${DEMO_DATE}`)}
          className="mt-4 rounded-lg bg-[#1468D4] px-4 py-2 text-sm font-semibold text-white"
        >
          Open the 21 May 2010 replay instead
        </button>
      </div>
    )
  }

  // On laptop/desktop screens (xl, 1280px+) the dashboard fills exactly one screen: the cards keep
  // their height and the two rows below share what is left. Narrower screens scroll as usual.
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 xl:h-full">
      <StatusRow cards={cards} />

      <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-[1.08] xl:grid-cols-2">
        <FiveDayForecast
          title={replay ? '5-day record' : '5-day outlook'}
          days={dates.map((date, i) => ({
            date,
            maxTaC: maxTa(i),
            band: band(i),
            bandWards: bandWards(i),
            level: levelOn(i),
            cloudPct: cloud(i),
          }))}
        />
        <RiskMap
          geojson={geo.data}
          zones={todayZones}
          onSelect={openWard}
          which={mapWhich}
          title={mapWhich === 'night' ? 'Where nights stay hot' : 'Ground heat by ward'}
          mapClassName="h-[300px] xl:h-auto"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)]">
        <RecommendedActions
          title={actionsTitle}
          note={actionsNote}
          showSource={showSource}
          rows={actions}
          loading={general.isLoading || trigQ[0]?.isLoading === true}
        />
        <HeatExposureChart
          metric={chartMetric}
          data={chartDay === 'today' ? h0 : h1}
          loading={(chartDay === 'today' ? hourlyQ[0] : hourlyQ[1])?.isLoading === true}
          error={(chartDay === 'today' ? hourlyQ[0] : hourlyQ[1])?.error ?? null}
          day={chartDay}
          onDayChange={setChartDay}
        />
      </div>
    </div>
  )
}
