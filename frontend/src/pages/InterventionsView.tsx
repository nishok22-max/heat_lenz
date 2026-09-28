/**
 * Interventions: what is known to reduce heat harm in Ahmedabad, for homes, outdoor work and the
 * city. Every statement is taken from a source checked on 2026-09-23 and named on screen:
 * - AMC Heat Action Plan 2019 (Easy Read): the plan's own evaluation, individual actions,
 *   labour-department actions, cooling centres, tree planting, cool-roof programme;
 * - Vellingiri et al. 2020 (Indian J Occup Environ Med 24(1):25-29; PMID 32435111) and the Mahila
 *   Housing Trust report it comes from: measured indoor air under different roofs;
 * - NDMA advisory for informal and gig workers (Aug 2025), as reported by Mongabay India;
 * - MoHFW National Action Plan on Heat-Related Illness: salt-containing drinks;
 * - Bowler et al. 2010 (Landscape and Urban Planning 97:147-155): park cooling.
 * Ward numbers come from GET /risk/zones (MODIS ground temperature, JRC population).
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  CheckCircle2,
  Circle,
  Droplets,
  ExternalLink,
  HardHat,
  Home,
  ShieldCheck,
  Sun,
  Trees,
  TrendingDown,
  AlertTriangle,
  Search,
  HeartPulse,
} from 'lucide-react'
import { DEFAULT_CITY, useForecast, useRiskZones, useTriggers, type ZoneRisk } from '../api/hooks'
import { ErrorMessage, SkeletonBlock } from '../components/layout/StateMessage'
import { groundHeat, lakh } from '../lib/plain'
import { round1 } from '../lib/surface'
import { isHapLevel } from '../lib/hap'

const NAVY = '#13265C'
const CARD = 'card'

// ------------------------------------------------------------------ sources
const SRC = {
  hap: {
    label: 'AMC Heat Action Plan 2019 (Easy Read)',
    url: 'https://www.nrdc.org/sites/default/files/ahmedabad-heat-action-plan-2018.pdf',
  },
  mht: {
    label: 'Vellingiri et al. 2020, Indian J Occup Environ Med 24(1):25–29 (Mahila Housing Trust study)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/32435111/',
  },
  ndmaGig: {
    label: 'NDMA advisory for informal and gig workers, Aug 2025 (reported by Mongabay India)',
    url: 'https://india.mongabay.com/2025/08/gig-work-heats-up-disaster-body-steps-in-with-advisory/',
  },
  naphri: {
    label: 'MoHFW National Action Plan on Heat-Related Illness',
    url: 'https://ncdc.mohfw.gov.in/uploads/pdf/heat12.pdf',
  },
  bowler: {
    label: 'Bowler et al. 2010, Landscape and Urban Planning 97:147–155',
    url: 'https://doi.org/10.1016/j.landurbplan.2010.05.006',
  },
} as const
type SrcKey = keyof typeof SRC

function Source({ id, extra }: { id: SrcKey; extra?: string }) {
  return (
    <a
      href={SRC[id].url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[12px] text-[#8A97B1] underline-offset-2 hover:text-[#3D4B6B] hover:underline"
    >
      Source: {SRC[id].label}
      {extra && `, ${extra}`}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

// ------------------------------------------------------------------ content (all sourced)

/** Measured indoor air, same day, same slum (Vellingiri et al. 2020 / MHT report). Means, °C. */
const ROOFS: { change: string; withIt: number; without: number; vs: string; note?: string; good: boolean }[] = [
  { change: 'Solar-reflective white paint on a tin roof', withIt: 33.5, without: 34.59, vs: 'plain tin roof', good: true },
  { change: 'Thermocol ceiling under an asbestos roof', withIt: 33.5, without: 35.88, vs: 'plain asbestos roof', good: true },
  {
    change: 'Modroof (modular roof panels)',
    withIt: 33.82,
    without: 35.8,
    vs: 'tin roof',
    note: '3.0 °C cooler than an asbestos roof',
    good: true,
  },
  {
    change: '"Airlite" roof ventilator on a tin roof',
    withIt: 37.77,
    without: 35.14,
    vs: 'plain tin roof',
    note: 'made the home warmer',
    good: false,
  },
]

/** AMC HAP 2019, "Community Groups and Individuals" (p.5 and p.17). */
const HOME_ACTIONS = [
  'Drink water, stay out of the sun and wear light clothing',
  'Check on vulnerable neighbours, especially during a heat alert',
  'Limit heavy work in direct sun, or indoors if poorly ventilated',
  'Talk to your local doctor or Urban Health Centre about the early signs of heat exhaustion',
]

/** MoHFW NAPHRI: "Oral rehydration with salt-containing fluids (...)". */
const SALT_DRINKS = [
  'ORS',
  'Lassi',
  'Nimbu pani',
  'Lime water with salt and sugar',
  'Rice water',
  'Dal water',
  'Coconut water',
  'Sattu',
]

/** NDMA advisory for gig and informal workers (Aug 2025), during IMD Orange and Red alerts. */
const NDMA_WORK = [
  'No mandatory outdoor work from 11 AM to 4 PM, or shorter two-hour shifts with cooling breaks',
  'A 15-minute cooling break every 90 minutes, without penalty or pay cut',
  'At least two litres of drinking water per shift',
  'Heat kits including ORS sachets and UV-protective clothing',
  'Workers may opt out without penalty; shaded rest zones and cooling shelters',
]

/** AMC HAP 2019, Labour & Employment Department, Red alert (p.16). */
const AMC_WORK = [
  'Shift outdoor workers’ schedules away from 1 PM – 5 PM during a heat alert',
  'Provide sufficient portable drinking water',
  'Change the working hours of labourers',
  'Emergency ice packs for traffic police, BRTS staff and construction workers (pilot)',
]

/** AMC HAP 2019: city measures (p.4, p.5, p.6). */
const CITY_ACTIONS = [
  { icon: Building2, text: 'Open cooling centres (temples, public buildings, malls) during a heat alert' },
  { icon: Home, text: 'Keep night shelters open all day for people without water or electricity' },
  { icon: Sun, text: 'Expand shaded areas for outdoor workers and slum communities' },
  { icon: Trees, text: 'Tree-planting campaign in hotspot areas, such as roadsides' },
  { icon: ShieldCheck, text: 'Cool roofs: mandatory on municipal and government buildings; low-income homes under the plan' },
]

// ------------------------------------------------------------------ small pieces

const TABS = [
  { id: 'home', label: 'At home', sub: 'Families and residents', icon: Home },
  { id: 'work', label: 'At work', sub: 'Outdoor workers and employers', icon: HardHat },
  { id: 'city', label: 'For the city', sub: 'Commissioner and ward officers', icon: Building2 },
] as const
type Tab = (typeof TABS)[number]['id']

const CHECK_KEY = 'heatlens.homeChecklist'
function loadChecks(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CHECK_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}
function saveChecks(v: Record<string, boolean>) {
  try {
    localStorage.setItem(CHECK_KEY, JSON.stringify(v))
  } catch {
    // storage blocked: the checklist still works for this visit
  }
}

function HourBar() {
  // 6 AM to 8 PM; NDMA 11-16 and AMC 13-17 drawn to scale.
  const start = 6
  const span = 14
  const pos = (h: number) => `${((h - start) / span) * 100}%`
  return (
    <div>
      <div className="relative h-16 rounded-xl bg-[#F1F5FB]">
        <div
          className="absolute top-2 h-5 truncate rounded-md bg-[#F97316]/85 px-2 text-[11px] font-semibold leading-5 text-white"
          style={{ left: pos(11), width: `calc(${pos(16)} - ${pos(11)})` }}
        >
          NDMA · 11 AM–4 PM
        </div>
        <div
          className="absolute bottom-2 h-5 truncate rounded-md bg-[#DC2626]/85 px-2 text-[11px] font-semibold leading-5 text-white"
          style={{ left: pos(13), width: `calc(${pos(17)} - ${pos(13)})` }}
        >
          AMC · 1–5 PM
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-[#8A97B1]">
        {[6, 8, 10, 12, 14, 16, 18, 20].map((h) => (
          <span key={h}>{h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`}</span>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ page

export default function InterventionsView() {
  const [tab, setTab] = useState<Tab>('home')
  const [checks, setChecks] = useState<Record<string, boolean>>(loadChecks)
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<'day' | 'night' | 'people'>('day')

  const forecast = useForecast(DEFAULT_CITY, 5)
  const today = forecast.data?.issue_date ?? ''
  const risk = useRiskZones(DEFAULT_CITY, today)
  const trig = useTriggers(DEFAULT_CITY, today)
  const levelRaw = trig.data?.groups[0]?.level
  const level = levelRaw && isHapLevel(levelRaw) ? levelRaw : null
  const nextAlert = forecast.data?.days.find((d) => d.hap_level === 'Orange' || d.hap_level === 'Red')
  const workRulesToday = level === 'Orange' || level === 'Red'

  const toggle = (k: string) =>
    setChecks((prev) => {
      const next = { ...prev, [k]: !prev[k] }
      saveChecks(next)
      return next
    })

  const wards = useMemo(() => {
    const zs: ZoneRisk[] = risk.data?.zones ?? []
    const key = (z: ZoneRisk) =>
      sortBy === 'day'
        ? z.surface_temperature?.lst_day_anomaly_c
        : sortBy === 'night'
          ? z.surface_temperature?.lst_night_anomaly_c
          : z.exposure.population_count
    return zs
      .filter((z) => !q || z.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity))
  }, [risk.data, q, sortBy])

  const maxDrop = Math.max(...ROOFS.filter((r) => r.good).map((r) => r.without - r.withIt))

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Title */}
      <div>
        <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
          What works against heat
        </h1>
        <p className="mt-1 text-[15px] text-[#3D4B6B]">
          Proven ways to cut heat harm in Ahmedabad. Every item below names its source.
        </p>
      </div>

      {/* The plan works */}
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#16A34A] text-white">
          <TrendingDown className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-bold" style={{ color: NAVY }}>
            About 2,380 deaths avoided after Ahmedabad started its Heat Action Plan
          </p>
          <p className="text-[14px] text-[#3D4B6B]">
            A 2018 study compared deaths in 2014–2015 with 2007–2010, after the 2010 heatwave caused 1,344 extra deaths. Acting
            early works.
          </p>
          <Source id="hap" extra="p.1" />
        </div>
      </section>

      {/* Tabs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TABS.map((t) => {
          const on = t.id === tab
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={on}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                on ? 'border-[#1468D4] bg-[#EEF5FF] ring-2 ring-[#1468D4]/20' : 'border-[#E3EBF5] bg-white hover:border-[#C9D8EC]'
              }`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-[#1468D4] text-white' : 'bg-[#F1F5FB] text-[#1468D4]'}`}
              >
                <t.icon className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <span>
                <span className="block text-[16px] font-bold" style={{ color: NAVY }}>
                  {t.label}
                </span>
                <span className="block text-[13px] text-[#6B7A99]">{t.sub}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ------------------------------------------------ AT HOME */}
      {tab === 'home' && (
        <div className="space-y-4">
          <section className={`${CARD} p-5`}>
            <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
              Cooler roofs, cooler homes
            </h2>
            <p className="text-[14px] text-[#3D4B6B]">
              Measured inside 16 homes in Ahmedabad slums (4–10 October 2017). Each change is compared with a home with the
              ordinary roof on the same day.
            </p>
            <div className="mt-4 space-y-3">
              {ROOFS.map((r) => {
                const diff = r.without - r.withIt
                return (
                  <div key={r.change} className="grid items-center gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px]">
                    <div>
                      <p className="text-[15px] font-semibold" style={{ color: NAVY }}>
                        {r.change}
                      </p>
                      <p className="text-[13px] text-[#6B7A99]">
                        {r.withIt} °C inside vs {r.without} °C with a {r.vs}
                        {r.note && ` · ${r.note}`}
                      </p>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-[#EEF2F7]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (Math.abs(diff) / maxDrop) * 100)}%`,
                          backgroundColor: r.good ? '#16A34A' : '#DC2626',
                        }}
                      />
                    </div>
                    <p className={`text-right text-[18px] font-bold ${r.good ? 'text-[#15803D]' : 'text-[#B91C1C]'}`}>
                      {r.good ? '−' : '+'}
                      {Math.abs(diff).toFixed(1)} °C
                    </p>
                  </div>
                )
              })}
            </div>
            <p className="mt-4 rounded-xl bg-[#F7FAFE] px-4 py-3 text-[14px] text-[#3D4B6B]">
              The AMC plan says cool roofs can keep indoor temperatures 2–5 °C lower than traditional roofs, depending on the
              setting. AMC lime-washed the roofs of 3,000 low-income homes in 2017–18 pilots.
            </p>
            <div className="mt-3 flex flex-col gap-1">
              <Source id="mht" />
              <Source id="hap" extra="p.6" />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={`${CARD} p-5`}>
              <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
                My heat checklist
              </h2>
              <p className="text-[13px] text-[#6B7A99]">What the AMC plan asks every resident to do. Tick what you do.</p>
              <div className="mt-3 space-y-2">
                {HOME_ACTIONS.map((a) => (
                  <button
                    key={a}
                    onClick={() => toggle(a)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-[15px] transition ${
                      checks[a] ? 'border-[#BBF7D0] bg-[#F0FDF4]' : 'border-[#EEF2F7] hover:bg-[#F7FAFE]'
                    }`}
                    style={{ color: NAVY }}
                  >
                    {checks[a] ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16A34A]" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-[#C0CAD8]" />
                    )}
                    {a}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <Source id="hap" extra="p.5, p.17" />
              </div>
            </section>

            <section className={`${CARD} p-5`}>
              <h2 className="flex items-center gap-2 text-[18px] font-semibold" style={{ color: NAVY }}>
                <Droplets className="h-6 w-6 text-[#1468D4]" /> Drinks that replace lost salt
              </h2>
              <p className="text-[14px] text-[#3D4B6B]">
                When you sweat a lot, plain water is not enough. The Health Ministry lists these salt-containing drinks:
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SALT_DRINKS.map((d) => (
                  <span
                    key={d}
                    className="rounded-full bg-[#EEF5FF] px-3.5 py-1.5 text-[14px] font-medium"
                    style={{ color: NAVY }}
                  >
                    {d}
                  </span>
                ))}
              </div>
              <Link
                to="/advice"
                className="mt-4 flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] font-semibold text-[#B91C1C] hover:bg-[#FDE8E8]"
              >
                <HeartPulse className="h-5 w-5" />
                Know the warning signs of heat illness, and when to call 108 →
              </Link>
              <div className="mt-3">
                <Source id="naphri" />
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ AT WORK */}
      {tab === 'work' && (
        <div className="space-y-4">
          <section
            className={`flex flex-wrap items-center gap-4 rounded-2xl border p-5 ${
              workRulesToday ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#E3EBF5] bg-white'
            }`}
          >
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white ${workRulesToday ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`}
            >
              {workRulesToday ? <AlertTriangle className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-bold" style={{ color: NAVY }}>
                {trig.isLoading
                  ? 'Checking today’s alert…'
                  : workRulesToday
                    ? 'The heat work rules apply today'
                    : 'The heat work rules do not apply today'}
              </p>
              <p className="text-[14px] text-[#3D4B6B]">
                They apply on Orange and Red alert days.{' '}
                {nextAlert
                  ? `Next forecast alert day: ${new Date(nextAlert.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}.`
                  : 'No Orange or Red alert in the next 5 days.'}
              </p>
            </div>
          </section>

          <section className={`${CARD} p-5`}>
            <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
              Hours to avoid on alert days
            </h2>
            <p className="mb-3 text-[14px] text-[#3D4B6B]">
              Two official rules. Following both means no heavy outdoor work from 11 AM to 5 PM.
            </p>
            <HourBar />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={`${CARD} p-5`}>
              <p className="text-[13px] font-bold uppercase tracking-wide text-[#F97316]">National · NDMA</p>
              <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
                For gig and informal workers
              </h2>
              <ul className="mt-3 space-y-2">
                {NDMA_WORK.map((w) => (
                  <li key={w} className="flex gap-2.5 text-[15px] leading-snug" style={{ color: NAVY }}>
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#F97316]" />
                    {w}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Source id="ndmaGig" />
              </div>
            </section>
            <section className={`${CARD} p-5`}>
              <p className="text-[13px] font-bold uppercase tracking-wide text-[#DC2626]">Ahmedabad · AMC</p>
              <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
                Labour department, on alert days
              </h2>
              <ul className="mt-3 space-y-2">
                {AMC_WORK.map((w) => (
                  <li key={w} className="flex gap-2.5 text-[15px] leading-snug" style={{ color: NAVY }}>
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" />
                    {w}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Source id="hap" extra="p.16" />
              </div>
            </section>
          </div>
          <Link
            to="/advice?for=construction"
            className="flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] font-semibold text-[#B91C1C] hover:bg-[#FDE8E8]"
          >
            <HeartPulse className="h-5 w-5" />
            Heat illness at the worksite: warning signs, first aid and 108 →
          </Link>
        </div>
      )}

      {/* ------------------------------------------------ FOR THE CITY */}
      {tab === 'city' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className={`${CARD} p-5`}>
              <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
                What the Heat Action Plan asks the city to do
              </h2>
              <ul className="mt-3 space-y-2.5">
                {CITY_ACTIONS.map((a) => (
                  <li key={a.text} className="flex gap-3 text-[15px] leading-snug" style={{ color: NAVY }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EEF5FF]">
                      <a.icon className="h-[18px] w-[18px] text-[#1468D4]" />
                    </span>
                    {a.text}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Source id="hap" extra="p.4–7" />
              </div>
            </section>
            <section className={`${CARD} p-5`}>
              <h2 className="flex items-center gap-2 text-[18px] font-semibold" style={{ color: NAVY }}>
                <Trees className="h-6 w-6 text-[#16A34A]" /> Parks cool the air around them
              </h2>
              <p className="mt-2 text-[40px] font-bold leading-none text-[#15803D]">0.94 °C</p>
              <p className="mt-1 text-[15px]" style={{ color: NAVY }}>
                On average, a park was this much cooler during the day than a non-green site.
              </p>
              <p className="mt-2 text-[14px] text-[#3D4B6B]">
                Studies of several parks suggest larger parks, and parks with trees, could be cooler. The review measured air
                inside and near parks; it does not give a figure for a whole ward.
              </p>
              <div className="mt-3">
                <Source id="bowler" />
              </div>
            </section>
          </div>

          <section className={`${CARD} p-5`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold" style={{ color: NAVY }}>
                  Where the ground gets hottest
                </h2>
                <p className="text-[13px] text-[#6B7A99]">
                  The plan asks for tree planting in hotspot areas. These are the wards whose ground is hottest by satellite, and
                  how many people live there.
                </p>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2">
                <label className="flex h-10 items-center gap-2 rounded-xl border border-[#DCE6F2] bg-white px-3">
                  <Search className="h-4 w-4 text-[#8A97B1]" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Find a ward"
                    className="w-32 bg-transparent text-[14px] outline-none"
                    style={{ color: NAVY }}
                  />
                </label>
                <div className="flex max-w-full overflow-x-auto rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] p-1">
                  {(
                    [
                      ['day', 'Hottest by day'],
                      ['night', 'Hottest at night'],
                      ['people', 'Most people'],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setSortBy(k)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${sortBy === k ? 'bg-white shadow-sm' : 'text-[#6B7A99]'}`}
                      style={sortBy === k ? { color: NAVY } : undefined}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {risk.isLoading && (
              <div className="mt-4">
                <SkeletonBlock lines={8} />
              </div>
            )}
            {risk.error && <ErrorMessage className="mt-4" error={risk.error} title="Could not load the wards." />}
            {wards.length > 0 && (
              <div className="mt-4 max-h-[520px] overflow-auto">
                <table className="w-full min-w-[640px] text-left text-[14px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-[12px] uppercase tracking-wide text-[#8A97B1]">
                      <th className="px-3 pb-2 font-semibold">#</th>
                      <th className="px-3 pb-2 font-semibold">Ward</th>
                      <th className="px-3 pb-2 font-semibold">Ground by day</th>
                      <th className="px-3 pb-2 font-semibold">Ground at night</th>
                      <th className="px-3 pb-2 font-semibold">People</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F7]" style={{ color: NAVY }}>
                    {wards.map((z, i) => {
                      const d = groundHeat(z.surface_temperature?.lst_day_anomaly_c)
                      const n = groundHeat(z.surface_temperature?.lst_night_anomaly_c)
                      const dv = z.surface_temperature?.lst_day_anomaly_c
                      const nv = z.surface_temperature?.lst_night_anomaly_c
                      return (
                        <tr key={z.zone_id}>
                          <td className="px-3 py-2.5 text-[#8A97B1]">{i + 1}</td>
                          <td className="px-3 py-2.5 font-semibold">{z.name}</td>
                          <td className="px-3 py-2.5" title={d.detail}>
                            {d.word}
                            {dv != null && (
                              <span className="ml-1 text-[12px] text-[#6B7A99]">
                                ({round1(dv) > 0 ? '+' : ''}
                                {round1(dv).toFixed(1)} °C)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5" title={n.detail}>
                            {n.word}
                            {nv != null && (
                              <span className="ml-1 text-[12px] text-[#6B7A99]">
                                ({round1(nv) > 0 ? '+' : ''}
                                {round1(nv).toFixed(1)} °C)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {z.exposure.population_count != null ? lakh(z.exposure.population_count) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[12px] text-[#8A97B1]">
              Ground temperature compared with the city average: NASA MODIS satellite, March–June 2022–2026. People: JRC
              population map, 2020.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
