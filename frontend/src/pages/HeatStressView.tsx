/**
 * Heat Stress: which wards of Ahmedabad are under the most heat stress on a day, and what the city
 * should do, in plain words. Every value comes from the API:
 * - GET /alerts/triggers: the official AMC alert level (AMC Heat Action Plan 2019 thresholds on
 *   the city's highest temperature) and the plan's department actions for that level;
 * - GET /risk/zones: each ward's HeatLens score (0-100, calibrated on May 2010 deaths),
 *   temperatures, main cause and population (JRC GHS-POP 2020);
 * - GET /advisory/{zone}: HeatLens's own city suggestions for the most stressed ward, shown apart
 *   from the plan and labelled as suggestions;
 * - POST /dispatch/preview: the SMS / WhatsApp text a ward would get. A dry run: nothing is sent.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  FileText,
  Flame,
  HeartPulse,
  Megaphone,
  MessageSquare,
  Search,
  ShieldCheck,
  Users,
  Zap,
  HardHat,
} from 'lucide-react'
import { DEFAULT_CITY, capUrl, useAdvisory, useCityZonesGeoJSON, useForecast, useRiskZones, useTriggers, type ZoneRisk } from '../api/hooks'
import { ErrorMessage, SkeletonBlock } from '../components/layout/StateMessage'
import RiskMap from '../components/dashboard/RiskMap'
import WardPanel from '../components/dashboard/WardPanel'
import MessagePreview from '../components/advisory/MessagePreview'
import { AMC_LEVEL_NAME, DEPARTMENT_LABEL, HAP_COLOR, isHapLevel, type HapLevel } from '../lib/hap'
import { LEVEL_PLAIN, driverPlain, lakh } from '../lib/plain'
import { addDays, dayMonth, scoreColor, utciCategory, weekdayShort } from '../lib/dashboard'
import { DEMO_DATE } from '../lib/dates'
import { isCityAction } from '../lib/advice'

const NAVY = '#13265C'
const DASH = '—'
const deg = (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v)}°C`)
const CARD = 'card'

const BANDS = ['Extreme', 'High', 'Moderate', 'Low'] as const
type Band = (typeof BANDS)[number]
const BAND_STYLE: Record<Band, { bg: string; fg: string; dot: string }> = {
  Extreme: { bg: '#FDE8E8', fg: '#B91C1C', dot: scoreColor(80) },
  High: { bg: '#FFEFE5', fg: '#C2410C', dot: scoreColor(60) },
  Moderate: { bg: '#FEF6DC', fg: '#A16207', dot: scoreColor(40) },
  Low: { bg: '#EAF7EC', fg: '#15803D', dot: scoreColor(15) },
}

const LEVEL_TINT: Record<HapLevel, string> = { Green: '#F1F8F2', Yellow: '#FFF8E1', Orange: '#FFF1E6', Red: '#FDECEC' }

const DEPT_ICON: Record<string, typeof Megaphone> = {
  public: Megaphone,
  municipal: Building2,
  health: HeartPulse,
  labour: HardHat,
  power_utility: Zap,
}

function isBand(b: string): b is Band {
  return (BANDS as readonly string[]).includes(b)
}

function BandPill({ band }: { band: string }) {
  const s = isBand(band) ? BAND_STYLE[band] : null
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold"
      style={{ backgroundColor: s?.bg ?? '#F1F5F9', color: s?.fg ?? '#475569' }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s?.dot ?? '#94A3B8' }} />
      {band}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-7 text-right text-[15px] font-bold tabular-nums" style={{ color: NAVY }}>
        {score.toFixed(0)}
      </span>
      <div className="h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-[#EEF2F7]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, score)}%`, backgroundColor: scoreColor(score) }} />
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  color,
  label,
  value,
  sub,
}: {
  icon: typeof Flame
  color: string
  label: string
  value: string
  sub?: ReactNode
}) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B7A99]">
        <Icon className="h-4 w-4 shrink-0" style={{ color }} strokeWidth={2} />
        {label}
      </div>
      <p className="mt-2 text-[24px] font-semibold leading-tight tracking-tight tabular-nums" style={{ color: NAVY }}>
        {value}
      </p>
      {sub && <div className="mt-1 text-[13px] text-[#6B7A99]">{sub}</div>}
    </div>
  )
}

export default function HeatStressView() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const replay = params.get('mode') === 'history'
  const forecast = useForecast(DEFAULT_CITY, 5)
  const issue = forecast.data?.issue_date ?? ''
  const dates = useMemo(
    () => (replay ? [params.get('date') ?? DEMO_DATE] : issue ? [0, 1, 2, 3, 4, 5].map((n) => addDays(issue, n)) : []),
    [replay, params, issue],
  )
  const [picked, setPicked] = useState('')
  const date = dates.includes(picked) ? picked : (dates[0] ?? '')

  const risk = useRiskZones(DEFAULT_CITY, date)
  const triggers = useTriggers(DEFAULT_CITY, date)
  const geo = useCityZonesGeoJSON(DEFAULT_CITY)

  const [band, setBand] = useState<'All' | Band>('All')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [msgZone, setMsgZone] = useState<ZoneRisk | null>(null)

  // Highest score first. Wards in one forecast grid cell share a score, so ties are common on live
  // dates; within a tie, the ward where more people live comes first.
  const zones = useMemo(
    () =>
      [...(risk.data?.zones ?? [])].sort(
        (a, b) =>
          Math.round(b.calibrated_score) - Math.round(a.calibrated_score) ||
          (b.exposure.population_count ?? 0) - (a.exposure.population_count ?? 0),
      ),
    [risk.data],
  )
  const topScore = zones[0] ? Math.round(zones[0].calibrated_score) : null
  const topTies = topScore == null ? 0 : zones.filter((z) => Math.round(z.calibrated_score) === topScore).length
  const suggestAdvisory = useAdvisory(zones[0]?.zone_id ?? null, DEFAULT_CITY, date, 'general')
  const suggestions = (suggestAdvisory.data?.recommendations ?? []).filter((r) => isCityAction(r.kind))
  const count = (b: Band) => zones.filter((z) => z.risk_band === b).length
  const atRisk = zones.filter((z) => z.risk_band === 'High' || z.risk_band === 'Extreme')
  const peopleAtRisk = atRisk.reduce((s, z) => s + (z.exposure.population_count ?? 0), 0)
  const hottest = zones.reduce<ZoneRisk | null>(
    (a, z) => ((z.thermal.ta_max_c ?? -99) > (a?.thermal.ta_max_c ?? -99) ? z : a),
    null,
  )
  const driverCounts = zones.reduce<Record<string, number>>(
    (m, z) => ({ ...m, [z.dominant_driver]: (m[z.dominant_driver] ?? 0) + 1 }),
    {},
  )
  const mainDriver = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const group = triggers.data?.groups[0]
  const level = group?.level && isHapLevel(group.level) ? group.level : null
  const plain = level ? LEVEL_PLAIN[level] : null
  const levelColor = level ? HAP_COLOR[level] : NAVY
  const actions = group?.actions ?? []
  const byDept = actions.reduce<Record<string, typeof actions>>(
    (m, a) => ({ ...m, [a.department]: [...(m[a.department] ?? []), a] }),
    {},
  )

  const shown = zones.filter(
    (z) => (band === 'All' || z.risk_band === band) && (!q || z.name.toLowerCase().includes(q.toLowerCase())),
  )
  const selected = zones.find((z) => z.zone_id === selectedId) ?? null

  const tabLabel = (d: string, i: number) =>
    replay ? `${dayMonth(d)} ${d.slice(0, 4)}` : i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayShort(d)

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Title + day picker */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
            Heat stress across Ahmedabad
          </h1>
          <p className="mt-1 text-[15px] text-[#3D4B6B]">Which wards are under the most heat stress, and what the city should do.</p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#E3EBF5] bg-white p-1 shadow-sm">
          {dates.map((d, i) => (
            <button
              key={d}
              onClick={() => {
                setPicked(d)
                setSelectedId(null)
              }}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-left text-[14px] leading-tight transition ${
                d === date ? 'bg-[#13265C] text-white shadow-sm' : 'text-[#3D4B6B] hover:bg-[#F4F8FC]'
              }`}
            >
              <span className="block font-semibold">{tabLabel(d, i)}</span>
              {!replay && (
                <span className={`block text-[12px] ${d === date ? 'text-white/70' : 'text-[#8A97B1]'}`}>{dayMonth(d)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Official alert */}
      <section
        className="overflow-hidden rounded-2xl border shadow-[0_1px_3px_rgba(19,38,92,0.05)]"
        style={{ backgroundColor: level ? LEVEL_TINT[level] : '#FFFFFF', borderColor: `${levelColor}40` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
              style={{ backgroundColor: levelColor }}
            >
              {level === 'Green' ? <ShieldCheck className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
            </span>
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[#6B7A99]">Official city alert (AMC)</p>
              <p className="text-[28px] font-bold leading-tight" style={{ color: level === 'Green' ? '#15803D' : levelColor }}>
                {plain?.headline ?? DASH}
              </p>
              <p className="text-[14px] text-[#3D4B6B]" title={triggers.data?.level_basis ?? undefined}>
                {level ? AMC_LEVEL_NAME[level] : ''}
                {triggers.data?.city_ta_max_c != null &&
                  ` · Hottest in the city: ${deg(triggers.data.city_ta_max_c)} (${triggers.data.city_ta_max_source})`}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-[#3D4B6B]">
              Practice mode · nothing is sent
            </span>
            <a
              href={capUrl(DEFAULT_CITY, date)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-[13px] font-semibold shadow-sm hover:bg-[#F7FAFE]"
              style={{ color: NAVY }}
              title="The same alert in CAP 1.2, the standard format used by alerting systems."
            >
              <FileText className="h-4 w-4" />
              Alert feed (CAP)
            </a>
          </div>
        </div>
        {level === 'Green' && atRisk.length > 0 && mainDriver && (
          <div className="border-t border-black/5 bg-white/60 px-5 py-3 text-[14px] text-[#3D4B6B]">
            <strong style={{ color: NAVY }}>Why no alert when heat stress is high?</strong> The official alert looks only at the
            day's highest temperature. The HeatLens score also counts humidity, sun and hot nights. Main cause today:{' '}
            <strong style={{ color: NAVY }}>{driverPlain(mainDriver).toLowerCase()}</strong>.
          </div>
        )}
      </section>

      {risk.error && (
        <ErrorMessage error={risk.error} title="Could not load ward heat stress for this day." onRetry={() => risk.refetch()} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={AlertTriangle}
          color="#8A97B1"
          label="Wards with high or extreme heat stress"
          value={!risk.data ? DASH : `${atRisk.length} of ${zones.length}`}
          sub={
            zones.length > 0 && (
              <div className="mt-1.5">
                <div className="flex h-2 overflow-hidden rounded-full bg-[#EEF2F7]">
                  {BANDS.map((b) => (
                    <div
                      key={b}
                      style={{ width: `${(count(b) / zones.length) * 100}%`, backgroundColor: BAND_STYLE[b].dot }}
                      title={`${b}: ${count(b)}`}
                    />
                  ))}
                </div>
                <p className="mt-1">
                  {BANDS.filter((b) => count(b))
                    .map((b) => `${count(b)} ${b.toLowerCase()}`)
                    .join(' · ')}
                </p>
              </div>
            )
          }
        />
        <Stat
          icon={Users}
          color="#8A97B1"
          label="People living in those wards"
          value={!risk.data ? DASH : peopleAtRisk ? `${lakh(peopleAtRisk)}` : '0'}
          sub="Estimate from the JRC population map (2020)"
        />
        <Stat
          icon={Flame}
          color="#8A97B1"
          label="Hottest ward"
          value={hottest ? deg(hottest.thermal.ta_max_c) : DASH}
          sub={
            !hottest
              ? undefined
              : zones.every((z) => z.thermal.ta_max_c === hottest.thermal.ta_max_c)
                ? 'Same in every ward (weather model for the whole city)'
                : `${hottest.name}${zones.filter((z) => z.thermal.ta_max_c === hottest.thermal.ta_max_c).length > 1 ? ' and others' : ''} (weather forecast)`
          }
        />
        <Stat
          icon={HeartPulse}
          color="#8A97B1"
          label="Main cause of heat stress"
          value={mainDriver ? driverPlain(mainDriver) : DASH}
          sub={mainDriver ? `In ${driverCounts[mainDriver]} of ${zones.length} wards` : undefined}
        />
      </div>

      {/* Map + most at risk / selected ward */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <RiskMap
          geojson={geo.data}
          zones={zones}
          colorBy="score"
          title="Heat stress by ward · tap a ward"
          mapClassName="h-[420px] lg:h-[520px]"
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="lg:h-[590px]">
          {selected ? (
            <WardPanel zone={selected} date={date} onClose={() => setSelectedId(null)} />
          ) : (
            <section className={`${CARD} flex h-full flex-col p-5`}>
              <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
                Most heat-stressed wards
              </h2>
              <p className="text-[13px] text-[#6B7A99]">
                Highest HeatLens score first. Tap a ward to see why.
                {topTies > 1 &&
                  ` ${topTies} wards share the top score (${topScore}) because they share one forecast grid cell; larger populations first.`}
              </p>
              {risk.isLoading ? (
                <div className="mt-4">
                  <SkeletonBlock lines={8} />
                </div>
              ) : (
                <ol className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {zones.slice(0, 10).map((z) => (
                    <li key={z.zone_id}>
                      <button
                        onClick={() => setSelectedId(z.zone_id)}
                        className="flex w-full items-center gap-3 rounded-xl border border-[#EEF2F7] px-3 py-2.5 text-left transition hover:border-[#C9D8EC] hover:bg-[#F7FAFE]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold" style={{ color: NAVY }}>
                            {z.name}
                          </span>
                          <span className="block truncate text-[12px] text-[#6B7A99]">
                            {deg(z.thermal.ta_max_c)} · {driverPlain(z.dominant_driver)}
                            {z.exposure.population_count != null && ` · ${lakh(z.exposure.population_count)} people`}
                          </span>
                        </span>
                        <span className="w-24 shrink-0">
                          <ScoreBar score={z.calibrated_score} />
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#8A97B1]" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      </div>

      {/* What the city should do */}
      <section className={`${CARD} p-5`}>
        <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
          What the city should do
        </h2>
        <p className="text-[13px] text-[#6B7A99]">
          From the AMC Heat Action Plan, for a {level ? AMC_LEVEL_NAME[level].split(' – ')[0] : DASH} level (
          {level ? LEVEL_PLAIN[level].headline.toLowerCase() : DASH}) day.
        </p>
        {actions.length === 0 ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#F1F8F2] px-4 py-3 text-[15px]" style={{ color: NAVY }}>
            <ShieldCheck className="h-5 w-5 shrink-0 text-[#15803D]" />
            The plan asks for no special measures at this level. {LEVEL_PLAIN.Green.actions[0]}
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(byDept).map(([dept, list]) => {
              const Icon = DEPT_ICON[dept] ?? Megaphone
              return (
                <div key={dept} className="rounded-xl border border-[#EEF2F7] p-4">
                  <p className="flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>
                    <Icon className="h-5 w-5 text-[#1468D4]" strokeWidth={1.8} />
                    {DEPARTMENT_LABEL[dept] ?? dept}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {list.map((a) => (
                      <li
                        key={a.action_id}
                        className="flex gap-2 text-[14px] leading-snug text-[#3D4B6B]"
                        title={`${a.detail}\n\nSource: ${a.basis}`}
                      >
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: levelColor }} />
                        {a.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
              HeatLens suggestions
            </h2>
            <span className="rounded bg-[#FFF4E5] px-1.5 py-px text-[11px] font-medium text-[#9A4B00]">Not part of the AMC plan</span>
          </div>
          <p className="text-[13px] text-[#6B7A99]">
            Extra steps the HeatLens score points to in the most stressed ward ({zones[0]?.name}), beyond what the plan asks at
            this level. For officials to weigh; not an instruction to residents.
          </p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {suggestions.map((r) => (
              <li key={r.kind + r.title} className="rounded-xl border border-[#EEF2F7] p-4">
                <p className="text-[15px] font-semibold leading-snug" style={{ color: NAVY }}>
                  {r.title}
                </p>
                <p className="mt-1 text-[13px] leading-snug text-[#3D4B6B]">{r.rationale}</p>
                <p className="mt-1.5 text-[12px] text-[#8A97B1]">Source: {r.basis}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Every ward */}
      <section className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
              All {zones.length} wards
            </h2>
            <p className="text-[13px] text-[#6B7A99]">
              Score: HeatLens heat-stress score, 0–100, calibrated on real deaths in the May 2010 heatwave (one event; see Methods).
            </p>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <label className="flex h-10 items-center gap-2 rounded-xl border border-[#DCE6F2] bg-white px-3">
              <Search className="h-4 w-4 text-[#8A97B1]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a ward"
                className="w-36 bg-transparent text-[14px] outline-none"
                style={{ color: NAVY }}
              />
            </label>
            <div className="flex max-w-full overflow-x-auto rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] p-1">
              {(['All', ...BANDS] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBand(b)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${band === b ? 'bg-white shadow-sm' : 'text-[#6B7A99] hover:text-[#13265C]'}`}
                  style={band === b ? { color: NAVY } : undefined}
                >
                  {b}
                  {b !== 'All' && <span className="ml-1 font-normal text-[#8A97B1]">{count(b)}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {risk.isLoading ? (
          <div className="mt-4">
            <SkeletonBlock lines={8} />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[14px]">
              <thead>
                <tr className="text-[12px] uppercase tracking-wide text-[#8A97B1]">
                  <th className="px-3 pb-2 font-semibold">Ward</th>
                  <th className="px-3 pb-2 font-semibold">Heat stress</th>
                  <th className="w-44 px-3 pb-2 font-semibold">Score</th>
                  <th className="px-3 pb-2 font-semibold">Hottest</th>
                  <th className="px-3 pb-2 font-semibold" title="UTCI: how hot it feels to the body in the sun.">
                    In the sun (UTCI)
                  </th>
                  <th className="px-3 pb-2 font-semibold">Main cause</th>
                  <th className="px-3 pb-2 font-semibold">People</th>
                  <th className="px-3 pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F7]" style={{ color: NAVY }}>
                {shown.map((z) => (
                  <tr
                    key={z.zone_id}
                    className="cursor-pointer transition hover:bg-[#F7FAFE]"
                    onClick={() => setSelectedId(z.zone_id)}
                  >
                    <td className="px-3 py-3 font-semibold">{z.name}</td>
                    <td className="px-3 py-3">
                      <BandPill band={z.risk_band} />
                    </td>
                    <td className="px-3 py-3">
                      <ScoreBar score={z.calibrated_score} />
                    </td>
                    <td className="px-3 py-3 tabular-nums">{deg(z.thermal.ta_max_c)}</td>
                    <td className="px-3 py-3">
                      <span className="tabular-nums">{deg(z.thermal.utci_max_c)}</span>
                      <span className="block text-[12px] text-[#6B7A99]">{utciCategory(z.thermal.utci_max_c)}</span>
                    </td>
                    <td className="px-3 py-3 text-[#3D4B6B]">{driverPlain(z.dominant_driver)}</td>
                    <td className="px-3 py-3 tabular-nums text-[#3D4B6B]">
                      {z.exposure.population_count != null ? lakh(z.exposure.population_count) : DASH}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMsgZone(z)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCE6F2] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1468D4] hover:bg-[#F4F8FC]"
                      >
                        <MessageSquare className="h-4 w-4" />
                        Message
                      </button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-[#6B7A99]">
                      No wards match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {risk.data?.coverage_note && <p className="mt-3 text-[12px] text-[#8A97B1]">{risk.data.coverage_note}</p>}
      </section>

      {msgZone && (
        <MessagePreview
          zoneId={msgZone.zone_id}
          zoneName={msgZone.name}
          date={date}
          onClose={() => setMsgZone(null)}
          extra={
            <button
              onClick={() => navigate(`/zones/${msgZone.zone_id}?date=${date}`)}
              className="rounded-xl border border-[#DCE6F2] px-4 py-2 text-[14px] font-semibold text-[#1468D4] hover:bg-[#F4F8FC]"
            >
              Ward details
            </button>
          }
        />
      )}
    </div>
  )
}

