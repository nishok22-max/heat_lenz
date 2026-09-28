/**
 * Health & Advice: how to stay safe in the heat, for one area and one day, in plain words.
 * - GET /advisory/{zone}: the advice for the chosen group (the backend rule engine, each item with
 *   its reason and published source), the official AMC level, and the published Ahmedabad
 *   heatwave death-risk estimate (de Bont et al. 2024);
 * - GET /risk/zones: the area list and today's temperatures for the chosen area;
 * - lib/heatIllness.ts: warning signs, first aid and emergency kit as published by NDMA;
 * - POST /dispatch/preview (MessagePreview): the SMS / WhatsApp text. Nothing is sent.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  Droplets,
  HardHat,
  HeartHandshake,
  HeartPulse,
  Info,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  Snowflake,
  Sun,
  Thermometer,
  Users,
} from 'lucide-react'
import { DEFAULT_CITY, useAdvisory, useForecast, useHourlyMany, useRiskZones, type Persona, type Recommendation } from '../api/hooks'
import { ErrorMessage, SkeletonBlock } from '../components/layout/StateMessage'
import HealthCard from '../components/health/HealthCard'
import MessagePreview from '../components/advisory/MessagePreview'
import { AMC_LEVEL_NAME, HAP_COLOR, isHapLevel, type HapLevel } from '../lib/hap'
import { LEVEL_PLAIN, deathRisk, lakh, scoreDeaths, stressWord } from '../lib/plain'
import { addDays, dayMonth, hourLabel, weekdayShort } from '../lib/dashboard'
import { DEMO_DATE } from '../lib/dates'
import { forResidents, residentTips } from '../lib/advice'
import {
  EMERGENCY_NUMBER,
  EMERGENCY_SOURCE,
  FIRST_AID,
  HEAT_ILLNESSES,
  HEAT_KIT,
  NDMA_HEAT_WAVE_URL,
  NDMA_SOURCE,
  type Illness,
} from '../lib/heatIllness'

const NAVY = '#13265C'
const DASH = '—'
const deg = (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v)}°C`)
const CARD = 'card'
const LEVEL_TINT: Record<HapLevel, string> = { Green: '#F1F8F2', Yellow: '#FFF8E1', Orange: '#FFF1E6', Red: '#FDECEC' }

const GROUPS: { id: Persona; label: string; sub: string; icon: typeof Users }[] = [
  { id: 'general', label: 'Everyone', sub: 'Families and residents', icon: Users },
  { id: 'elderly', label: 'Older people', sub: 'Aged 60 and above', icon: HeartHandshake },
  { id: 'construction', label: 'Outdoor workers', sub: 'Construction, street and gig work', icon: HardHat },
]

/** Advice kind (backend/rules/advisory_rules.toml) -> icon and colour. */
const KIND: Record<string, { icon: typeof Droplets; color: string; label: string }> = {
  hydration: { icon: Droplets, color: '#1468D4', label: 'Water' },
  cooling_centre: { icon: Snowflake, color: '#0891B2', label: 'Keep cool' },
  vulnerable_check: { icon: HeartHandshake, color: '#7C3AED', label: 'Check on others' },
  work_hours: { icon: HardHat, color: '#D97706', label: 'Work' },
  health_alert: { icon: HeartPulse, color: '#DC2626', label: 'Health' },
  regional_alert: { icon: AlertTriangle, color: '#EA580C', label: 'Alert' },
  general: { icon: Sun, color: '#F59E0B', label: 'General' },
}

const SEVERITY: Record<string, { label: string; bg: string; fg: string }> = {
  high: { label: 'Do this today', bg: '#FDE8E8', fg: '#B91C1C' },
  moderate: { label: 'Recommended', bg: '#FEF6DC', fg: '#A16207' },
  low: { label: 'Good to know', bg: '#EEF4FB', fg: '#1468D4' },
}

const ILLNESS_STYLE: Record<Illness['level'], { tag: string; bg: string; fg: string; border: string }> = {
  mild: { tag: 'Watch out', bg: '#FFFBEB', fg: '#A16207', border: '#FDE68A' },
  serious: { tag: 'Act now', bg: '#FFF4ED', fg: '#C2410C', border: '#FED7AA' },
  emergency: { tag: `Emergency · call ${EMERGENCY_NUMBER}`, bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA' },
}

function AdviceCard({ rec }: { rec: Recommendation }) {
  const k = KIND[rec.kind] ?? KIND.general
  const sev = SEVERITY[rec.severity] ?? SEVERITY.low
  return (
    <div className={`${CARD} flex flex-col p-4`}>
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${k.color}14` }}
        >
          <k.icon className="h-6 w-6" style={{ color: k.color }} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[#8A97B1]">{k.label}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[12px] font-semibold"
              style={{ backgroundColor: sev.bg, color: sev.fg }}
            >
              {sev.label}
            </span>
          </div>
          <p className="mt-1 text-[17px] font-semibold leading-snug" style={{ color: NAVY }}>
            {rec.title}
          </p>
        </div>
      </div>
      <details className="group mt-3 rounded-xl bg-[#F7FAFE] px-3 py-2 text-[13px]">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-[#1468D4]">
          <Info className="h-4 w-4" />
          Why?
          <ChevronDown className="ml-auto h-4 w-4 transition group-open:rotate-180" />
        </summary>
        <p className="mt-2 leading-snug text-[#3D4B6B]">{rec.rationale}</p>
        <p className="mt-1.5 text-[12px] text-[#8A97B1]">Source: {rec.basis}</p>
      </details>
    </div>
  )
}

export default function AdvisoryView() {
  const { zoneId } = useParams<{ zoneId: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const forecast = useForecast(DEFAULT_CITY, 5)
  const issue = forecast.data?.issue_date ?? ''
  const requested = params.get('date')
  const replay = params.get('mode') === 'history'
  const liveDates = useMemo(() => (issue ? [0, 1, 2, 3, 4, 5].map((n) => addDays(issue, n)) : []), [issue])
  const date = requested ?? (replay ? DEMO_DATE : issue)
  const dates = replay || (requested && !liveDates.includes(requested)) ? [date] : liveDates
  const persona: Persona = GROUPS.some((g) => g.id === params.get('for')) ? (params.get('for') as Persona) : 'general'
  const [msgOpen, setMsgOpen] = useState(false)

  const zonesQ = useRiskZones(DEFAULT_CITY, date)
  const hourlyDates = useMemo(() => (date ? [date] : []), [date])
  const hourly = useHourlyMany(DEFAULT_CITY, hourlyDates)[0]?.data
  const peak =
    hourly?.peak_start_hour != null && hourly?.peak_end_hour != null
      ? `${hourLabel(hourly.peak_start_hour)} – ${hourLabel(hourly.peak_end_hour)}`
      : null
  const { data, isLoading, error, refetch } = useAdvisory(zoneId ?? null, DEFAULT_CITY, date, persona)
  const areas = useMemo(() => [...(zonesQ.data?.zones ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [zonesQ.data])
  const zone = areas.find((z) => z.zone_id === zoneId) ?? null

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    setParams(next, { replace: true })
  }
  const goArea = (id: string) => navigate(`/advisory/${id}?${params.toString()}`)
  const tabLabel = (d: string, i: number) =>
    dates.length === 1 && !liveDates.includes(d)
      ? `${dayMonth(d)} ${d.slice(0, 4)}`
      : i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : weekdayShort(d)

  const level = data?.hap_trigger && isHapLevel(data.hap_trigger) ? data.hap_trigger : null
  const plain = level ? LEVEL_PLAIN[level] : null
  const levelColor = level ? HAP_COLOR[level] : NAVY
  const health = data?.health
  const risk = health ? deathRisk(health.relative_risk, health.exposure_tier) : null
  // Residents see only what they can do themselves; city jobs (cooling centres, health-worker visits)
  // are shown to officials on the Heat Stress page as HeatLens suggestions.
  const recs = forResidents(data?.recommendations ?? []).sort(
    (a, b) => ['high', 'moderate', 'low'].indexOf(a.severity) - ['high', 'moderate', 'low'].indexOf(b.severity),
  )

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Title + controls */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
            Health &amp; advice
          </h1>
          <p className="mt-1 text-[15px] text-[#3D4B6B]">How to stay safe in the heat, for you and the people you care for.</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <label className="flex h-[52px] items-center gap-2 rounded-xl border border-[#E3EBF5] bg-white px-3 shadow-sm">
            <MapPin className="h-5 w-5 shrink-0 text-[#1468D4]" />
            <select
              value={zoneId}
              onChange={(e) => goArea(e.target.value)}
              className="max-w-[200px] bg-transparent text-[15px] font-semibold outline-none"
              style={{ color: NAVY }}
              aria-label="Area"
            >
              {areas.length === 0 && <option value={zoneId}>{zoneId}</option>}
              {areas.map((a) => (
                <option key={a.zone_id} value={a.zone_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#E3EBF5] bg-white p-1 shadow-sm">
            {dates.map((d, i) => (
              <button
                key={d}
                onClick={() => set('date', d)}
                className={`shrink-0 rounded-lg px-3.5 py-1.5 text-left text-[14px] leading-tight transition ${
                  d === date ? 'bg-[#13265C] text-white shadow-sm' : 'text-[#3D4B6B] hover:bg-[#F4F8FC]'
                }`}
              >
                <span className="block font-semibold">{tabLabel(d, i)}</span>
                {liveDates.includes(d) && (
                  <span className={`block text-[12px] ${d === date ? 'text-white/70' : 'text-[#8A97B1]'}`}>{dayMonth(d)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Who is this for */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {GROUPS.map((g) => {
          const on = g.id === persona
          return (
            <button
              key={g.id}
              onClick={() => set('for', g.id)}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                on ? 'border-[#1468D4] bg-[#EEF5FF] ring-2 ring-[#1468D4]/20' : 'border-[#E3EBF5] bg-white hover:border-[#C9D8EC]'
              }`}
              aria-pressed={on}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-[#1468D4] text-white' : 'bg-[#F1F5FB] text-[#1468D4]'}`}
              >
                <g.icon className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <span>
                <span className="block text-[16px] font-bold" style={{ color: NAVY }}>
                  {g.label}
                </span>
                <span className="block text-[13px] text-[#6B7A99]">{g.sub}</span>
              </span>
            </button>
          )
        })}
      </div>

      {error && <ErrorMessage error={error} title="Could not load the advice for this day." onRetry={() => refetch()} />}
      {isLoading && <SkeletonBlock lines={8} />}

      {data && (
        <>
          {/* Today in this area */}
          <section
            className="rounded-2xl border p-5 shadow-[0_1px_3px_rgba(19,38,92,0.05)]"
            style={{ backgroundColor: level ? LEVEL_TINT[level] : '#FFFFFF', borderColor: `${levelColor}40` }}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div className="flex items-center gap-4">
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
                  style={{ backgroundColor: levelColor }}
                >
                  {level === 'Green' ? <ShieldCheck className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#3D4B6B]">
                    {zone?.name ?? zoneId} · {tabLabel(date, dates.indexOf(date))}
                  </p>
                  <p
                    className="text-[28px] font-bold leading-tight"
                    style={{ color: level === 'Green' ? '#15803D' : levelColor }}
                  >
                    {plain?.headline ?? DASH}
                  </p>
                  <p className="text-[14px] text-[#3D4B6B]" title={data.hap_trigger_basis}>
                    Official city alert (AMC): {level ? AMC_LEVEL_NAME[level] : DASH}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-white/80 px-4 py-3" title={zone?.weather_basis ?? undefined}>
                  <p className="flex items-center gap-1.5 text-[13px] text-[#3D4B6B]">
                    <Thermometer className="h-4 w-4 text-[#EF4444]" /> Hottest here
                  </p>
                  <p className="text-[22px] font-bold" style={{ color: NAVY }}>
                    {deg(zone?.thermal.ta_max_c)}
                  </p>
                </div>
                <div
                  className="rounded-xl bg-white/80 px-4 py-3"
                  title={`HeatLens heat-stress score (0-100). ${scoreDeaths(zone?.score_mortality, zone?.calibrated_score).detail}`}
                >
                  <p className="flex items-center gap-1.5 text-[13px] text-[#3D4B6B]">
                    <Sun className="h-4 w-4 text-[#F97316]" /> Heat stress (HeatLens)
                  </p>
                  <p className="text-[22px] font-bold" style={{ color: NAVY }}>
                    {stressWord(data.risk_band).replace(' heat stress', '')}
                  </p>
                </div>
                <div className="col-span-2 rounded-xl bg-white/80 px-4 py-3" title={risk?.detail}>
                  <p className="flex items-center gap-1.5 text-[13px] text-[#3D4B6B]">
                    <HeartPulse className="h-4 w-4 text-[#DC2626]" /> Health risk for the city
                  </p>
                  <p className="text-[17px] font-bold leading-snug" style={{ color: NAVY }}>
                    {risk?.word ?? DASH}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* What to do */}
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
                  What to do · {GROUPS.find((g) => g.id === persona)?.label.toLowerCase()}
                </h2>
                <p className="text-[13px] text-[#6B7A99]">Most important first. Tap “Why?” to see the reason and the source.</p>
              </div>
              <button
                onClick={() => setMsgOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-[#13265C] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#0E1D49]"
              >
                <MessageSquare className="h-4 w-4" />
                Share as SMS / WhatsApp
              </button>
            </div>
            {/* The base advice for today's official level: the same list the dashboard and the
                residents' page show (lib/advice.ts). */}
            <ul className="mb-3 flex flex-wrap gap-2">
              {residentTips(level, 'en', peak != null).map((t) => (
                <li
                  key={t.key}
                  className="flex items-center gap-2 rounded-full border border-[#E4EAF3] bg-white px-3.5 py-1.5 text-[14px] font-medium"
                  style={{ color: NAVY }}
                >
                  <t.icon className="h-4 w-4 text-[#1468D4]" strokeWidth={1.9} />
                  {t.text}
                </li>
              ))}
              {peak && (
                <li className="flex items-center gap-2 rounded-full bg-[#F1F4F9] px-3.5 py-1.5 text-[14px] text-[#3D4B6B]">
                  Hottest hours: <span className="font-semibold" style={{ color: NAVY }}>{peak}</span>
                </li>
              )}
            </ul>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {recs.map((r, i) => (
                <AdviceCard key={`${r.kind}-${i}`} rec={r} />
              ))}
              {recs.length === 0 && (
                <div className={`${CARD} flex items-center gap-3 p-4 text-[15px] md:col-span-2 xl:col-span-3`} style={{ color: NAVY }}>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-[#15803D]" />
                  {LEVEL_PLAIN.Green.actions[0]}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Warning signs + first aid (always shown: it is the same on every day) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className={`${CARD} p-5`}>
          <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
            Know the warning signs
          </h2>
          <p className="text-[13px] text-[#6B7A99]">Heat illness gets worse step by step. Act early.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {HEAT_ILLNESSES.map((ill) => {
              const s = ILLNESS_STYLE[ill.level]
              return (
                <div key={ill.name} className="rounded-xl border p-4" style={{ backgroundColor: s.bg, borderColor: s.border }}>
                  <span
                    className="inline-block rounded-full bg-white px-2.5 py-0.5 text-[12px] font-bold"
                    style={{ color: s.fg }}
                  >
                    {s.tag}
                  </span>
                  <p className="mt-2 text-[17px] font-bold" style={{ color: NAVY }}>
                    {ill.name}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {ill.signs.map((x) => (
                      <li key={x} className="flex gap-2 text-[14px] leading-snug text-[#3D4B6B]">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.fg }} />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
          <a
            href={`tel:${EMERGENCY_NUMBER}`}
            className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#DC2626] px-4 py-3 text-white shadow-sm hover:bg-[#B91C1C]"
            title={EMERGENCY_SOURCE}
          >
            <span className="flex items-center gap-3">
              <Phone className="h-6 w-6" />
              <span>
                <span className="block text-[16px] font-bold">Emergency ambulance: {EMERGENCY_NUMBER}</span>
                <span className="block text-[13px] text-white/85">
                  Call if someone is confused, has a seizure, or will not wake up.
                </span>
              </span>
            </span>
            <span className="rounded-lg bg-white/20 px-3 py-1.5 text-[14px] font-bold">Call</span>
          </a>
        </section>

        <section className={`${CARD} p-5`}>
          <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
            If someone is unwell from the heat
          </h2>
          <ol className="mt-3 space-y-2">
            {FIRST_AID.map((step, i) => (
              <li key={step} className="flex gap-3 text-[14px] leading-snug" style={{ color: NAVY }}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF5FF] text-[12px] font-bold text-[#1468D4]">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[13px] font-bold uppercase tracking-wide text-[#6B7A99]">Keep with you</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {HEAT_KIT.map((k) => (
              <span key={k} className="rounded-full bg-[#F1F5FB] px-3 py-1.5 text-[13px] font-medium" style={{ color: NAVY }}>
                {k}
              </span>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-[#8A97B1]">
            Source:{' '}
            <a href={NDMA_HEAT_WAVE_URL} target="_blank" rel="noreferrer" className="underline hover:text-[#3D4B6B]">
              {NDMA_SOURCE}
            </a>
            .
          </p>
        </section>
      </div>

      {/* Official detail, folded away */}
      {data && health && (
        <details className={`${CARD} group`}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
            <span>
              <span className="text-[17px] font-bold" style={{ color: NAVY }}>
                Detailed numbers
              </span>
              <span className="ml-2 text-[14px] text-[#6B7A99]">for health officials</span>
            </span>
            <ChevronDown className="h-5 w-5 text-[#6B7A99] transition group-open:rotate-180" />
          </summary>
          <div className="grid gap-5 border-t border-[#EEF2F7] p-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[14px] font-bold" style={{ color: NAVY }}>
                Heatwave death-risk estimate
              </p>
              <HealthCard health={health} />
            </div>
            <div>
              <p className="mb-2 flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>
                <Building2 className="h-4 w-4 text-[#1468D4]" /> Alert in standard format (CAP 1.2)
              </p>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[14px]">
                {(
                  [
                    ['Event', data.cap_preview.event],
                    ['Urgency', data.cap_preview.urgency],
                    ['Severity', data.cap_preview.severity],
                    ['Certainty', data.cap_preview.certainty],
                    ['Status', data.cap_preview.status],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-[#6B7A99]">{k}</dt>
                    <dd style={{ color: NAVY }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[14px]" style={{ color: NAVY }}>
                {data.cap_preview.headline}
              </p>
              <p className="mt-1 text-[12px] text-[#6B7A99]">{data.cap_preview.description}</p>
              {zone?.exposure.population_count != null && (
                <p className="mt-3 text-[13px] text-[#3D4B6B]">
                  About {lakh(zone.exposure.population_count)} people live in {zone.name} (JRC population map, 2020).
                </p>
              )}
              <Link to="/heat-stress" className="mt-3 inline-block text-[14px] font-semibold text-[#1468D4] hover:underline">
                What the city is doing today →
              </Link>
            </div>
          </div>
        </details>
      )}

      {msgOpen && zoneId && (
        <MessagePreview
          zoneId={zoneId}
          zoneName={zone?.name ?? zoneId}
          date={date}
          persona={persona}
          onClose={() => setMsgOpen(false)}
        />
      )}
    </div>
  )
}
