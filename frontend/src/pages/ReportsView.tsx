/**
 * Daily heat report: one printable page for a day, in plain words, plus the ward table as CSV and
 * the draft CAP 1.2 alert. Every value comes from the API:
 * - GET /alerts/triggers: the official AMC level, the city's highest temperature and its source,
 *   and the Heat Action Plan actions for that level;
 * - GET /risk/zones: each ward's HeatLens score, temperatures, main cause, ground heat (MODIS) and
 *   population (JRC GHS-POP 2020). On live dates each ward has its own forecast grid cell.
 * A prototype document: not issued by or on behalf of AMC, IMD or any government body.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileText, Printer } from 'lucide-react'
import { DEFAULT_CITY, capUrl, useForecast, useRiskZones, useTriggers, type ZoneRisk } from '../api/hooks'
import { SkeletonBlock, ErrorMessage } from '../components/layout/StateMessage'
import { AMC_LEVEL_NAME, DEPARTMENT_LABEL, HAP_COLOR, isHapLevel, type HapLevel } from '../lib/hap'
import { LEVEL_PLAIN, driverPlain, groundHeat, lakh } from '../lib/plain'
import { addDays, dayMonth, scoreColor, weekdayShort } from '../lib/dashboard'
import { DEMO_DATE, longDate } from '../lib/dates'

const NAVY = '#13265C'
const DASH = '—'
const deg = (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v)}°C`)
const LEVEL_TINT: Record<HapLevel, string> = { Green: '#F1F8F2', Yellow: '#FFF8E1', Orange: '#FFF1E6', Red: '#FDECEC' }
const BANDS = ['Extreme', 'High', 'Moderate', 'Low'] as const

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(zones: ZoneRisk[], date: string) {
  const header = [
    'ward_id',
    'ward_name',
    'heatlens_score_0_100',
    'deaths_vs_normal_day_may2010_fit',
    'risk_band',
    'main_cause',
    'air_temp_max_c',
    'feels_like_in_sun_utci_max_c',
    'work_safety_wbgt_max_c',
    'night_min_c',
    'ground_heat_day_vs_city_c',
    'ground_heat_night_vs_city_c',
    'population_2020_model',
    'weather_basis',
  ]
  const rows = zones.map((z) =>
    [
      z.zone_id,
      z.name,
      z.calibrated_score.toFixed(1),
      z.score_mortality?.death_ratio?.toFixed(2),
      z.risk_band,
      z.dominant_driver,
      z.thermal.ta_max_c?.toFixed(1),
      z.thermal.utci_max_c?.toFixed(1),
      z.thermal.wbgt_max_c?.toFixed(1),
      z.thermal.night_min_ta_c?.toFixed(1),
      z.surface_temperature?.lst_day_anomaly_c?.toFixed(2),
      z.surface_temperature?.lst_night_anomaly_c?.toFixed(2),
      z.exposure.population_count,
      z.weather_basis,
    ]
      .map(csvCell)
      .join(','),
  )
  const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `HeatLens_Ahmedabad_wards_${date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsView() {
  const [params] = useSearchParams()
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
  const trig = useTriggers(DEFAULT_CITY, date)
  // Highest score first; wards in one forecast grid cell share a score, so within a tie the ward
  // where more people live comes first (the same order as the Heat Stress page).
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
  const hottestGround = useMemo(
    () =>
      [...zones].sort(
        (a, b) =>
          (b.surface_temperature?.lst_day_anomaly_c ?? -Infinity) - (a.surface_temperature?.lst_day_anomaly_c ?? -Infinity),
      ),
    [zones],
  )

  const group = trig.data?.groups[0]
  const level = group?.level && isHapLevel(group.level) ? group.level : null
  const levelColor = level ? HAP_COLOR[level] : NAVY
  const actions = group?.actions ?? []
  const byDept = actions.reduce<Record<string, typeof actions>>(
    (m, a) => ({ ...m, [a.department]: [...(m[a.department] ?? []), a] }),
    {},
  )
  const count = (b: string) => zones.filter((z) => z.risk_band === b).length
  const atRisk = zones.filter((z) => z.risk_band === 'High' || z.risk_band === 'Extreme')
  const people = atRisk.reduce((s, z) => s + (z.exposure.population_count ?? 0), 0)
  const drivers = zones.reduce<Record<string, number>>(
    (m, z) => ({ ...m, [z.dominant_driver]: (m[z.dominant_driver] ?? 0) + 1 }),
    {},
  )
  const mainDriver = Object.entries(drivers).sort((a, b) => b[1] - a[1])[0]?.[0]
  const loading = risk.isLoading || trig.isLoading
  const tabLabel = (d: string, i: number) =>
    replay ? `${dayMonth(d)} ${d.slice(0, 4)}` : i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayShort(d)

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 print:max-w-none">
      {/* Controls (not printed) */}
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
            Daily heat report
          </h1>
          <p className="mt-1 text-[15px] text-[#3D4B6B]">
            One page to print or share: the day's official alert, the most heat-stressed wards and what to do.
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#E3EBF5] bg-white p-1 shadow-sm">
            {dates.map((d, i) => (
              <button
                key={d}
                onClick={() => setPicked(d)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[14px] font-semibold ${
                  d === date ? 'bg-[#13265C] text-white' : 'text-[#3D4B6B] hover:bg-[#F4F8FC]'
                }`}
              >
                {tabLabel(d, i)}
              </button>
            ))}
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-xl border border-[#DCE6F2] bg-white px-3.5 py-2 text-[14px] font-semibold shadow-sm hover:bg-[#F7FAFE]"
            style={{ color: NAVY }}
          >
            <Printer className="h-4 w-4" /> Print
          </button>
          <button
            onClick={() => downloadCsv(zones, date)}
            disabled={!zones.length}
            className="flex items-center gap-2 rounded-xl bg-[#13265C] px-3.5 py-2 text-[14px] font-semibold text-white shadow-sm hover:bg-[#0E1D49] disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Ward table (CSV)
          </button>
          <a
            href={capUrl(DEFAULT_CITY, date)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-[#DCE6F2] bg-white px-3.5 py-2 text-[14px] font-semibold shadow-sm hover:bg-[#F7FAFE]"
            style={{ color: NAVY }}
            title="The alert in CAP 1.2, the standard format used by alerting systems. Draft only."
          >
            <FileText className="h-4 w-4" /> Alert feed (CAP)
          </a>
        </div>
      </div>

      {loading ? (
        <SkeletonBlock lines={12} />
      ) : risk.error || trig.error || !risk.data ? (
        <ErrorMessage
          error={risk.error ?? trig.error}
          title="Could not load the data for this report."
          onRetry={() => {
            risk.refetch()
            trig.refetch()
          }}
        />
      ) : (
        <article className="card p-6 sm:p-8 print:border-0 print:p-0 print:shadow-none">
          {/* Letterhead */}
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EEF2F7] pb-5">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[#6B7A99]">HeatLens · Ahmedabad</p>
              <h2 className="text-[24px] font-bold leading-tight" style={{ color: NAVY }}>
                Heat report for {longDate(date)}
              </h2>
            </div>
            <span className="rounded-full bg-[#F1F5FB] px-3 py-1 text-[12px] font-semibold text-[#3D4B6B]">
              Prototype · draft, not an official bulletin
            </span>
          </header>

          {/* Alert */}
          <section
            className="mt-5 rounded-xl border p-4"
            style={{ backgroundColor: level ? LEVEL_TINT[level] : '#FFFFFF', borderColor: `${levelColor}40` }}
          >
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[#6B7A99]">Official city alert (AMC)</p>
            <p className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: level === 'Green' ? '#15803D' : levelColor }}>
              {level ? LEVEL_PLAIN[level].headline : DASH}
            </p>
            <p className="text-[14px] text-[#3D4B6B]">
              {level ? `${AMC_LEVEL_NAME[level]}. ${LEVEL_PLAIN[level].meaning}` : ''}
              {trig.data?.city_ta_max_c != null &&
                ` Hottest in the city: ${deg(trig.data.city_ta_max_c)} (${trig.data.city_ta_max_source}).`}
            </p>
          </section>

          {/* In one paragraph */}
          <section className="mt-5">
            <h3 className="text-[17px] font-bold" style={{ color: NAVY }}>
              Summary
            </h3>
            <p className="mt-1 text-[15px] leading-relaxed text-[#3D4B6B]">
              {atRisk.length} of {zones.length} wards have high or extreme heat stress on the HeatLens score
              {people > 0 && `, home to about ${lakh(people)} people`}.
              {mainDriver && ` The main cause is ${driverPlain(mainDriver).toLowerCase()}.`}{' '}
              {level === 'Green' && atRisk.length > 0
                ? 'There is no official alert because the alert looks only at the highest temperature; the HeatLens score also counts humidity, sun and hot nights.'
                : ''}
            </p>
          </section>

          {/* Numbers */}
          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BANDS.map((b) => (
              <div key={b} className="rounded-xl border border-[#EEF2F7] p-3">
                <p className="flex items-center gap-2 text-[13px] text-[#6B7A99]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: scoreColor({ Extreme: 80, High: 60, Moderate: 40, Low: 15 }[b]) }}
                  />
                  {b} heat stress
                </p>
                <p className="text-[24px] font-bold" style={{ color: NAVY }}>
                  {count(b)} <span className="text-[14px] font-normal text-[#6B7A99]">wards</span>
                </p>
              </div>
            ))}
          </section>

          {/* Actions */}
          <section className="mt-6 break-inside-avoid">
            <h3 className="text-[17px] font-bold" style={{ color: NAVY }}>
              What the Heat Action Plan asks for at this level
            </h3>
            {actions.length === 0 ? (
              <p className="mt-1 text-[15px] text-[#3D4B6B]">No special measures at this level. {LEVEL_PLAIN.Green.actions[0]}</p>
            ) : (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {Object.entries(byDept).map(([dept, list]) => (
                  <div key={dept} className="rounded-xl border border-[#EEF2F7] p-3">
                    <p className="text-[14px] font-bold" style={{ color: NAVY }}>
                      {DEPARTMENT_LABEL[dept] ?? dept}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {list.map((a) => (
                        <li key={a.action_id} className="flex gap-2 text-[14px] leading-snug text-[#3D4B6B]">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: levelColor }} />
                          {a.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Wards */}
          <div className="mt-6 grid gap-5 lg:grid-cols-2 print:grid-cols-2">
            <section className="break-inside-avoid">
              <h3 className="text-[17px] font-bold" style={{ color: NAVY }}>
                Most heat-stressed wards
              </h3>
              <p className="text-[12px] text-[#6B7A99]">
                By HeatLens heat-stress score (0–100).
                {topTies > 1 &&
                  ` ${topTies} wards share the top score of ${topScore}: they fall in one weather-forecast grid cell. Among them, larger populations first.`}
              </p>
              <table className="mt-2 w-full text-left text-[14px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[#8A97B1]">
                    <th className="py-1 font-semibold">Ward</th>
                    <th className="py-1 text-right font-semibold">People</th>
                    <th className="py-1 text-right font-semibold">Score</th>
                    <th className="py-1 pl-3 text-right font-semibold">Max</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F7]" style={{ color: NAVY }}>
                  {zones.slice(0, 8).map((z) => (
                    <tr key={z.zone_id}>
                      <td className="py-1.5 font-semibold">{z.name}</td>
                      <td className="py-1.5 text-right tabular-nums text-[#6B7A99]">
                        {z.exposure.population_count != null ? lakh(z.exposure.population_count) : DASH}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{z.calibrated_score.toFixed(0)}</td>
                      <td className="py-1.5 pl-3 text-right text-[#6B7A99]">{deg(z.thermal.ta_max_c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="break-inside-avoid">
              <h3 className="text-[17px] font-bold" style={{ color: NAVY }}>
                Where the ground is hottest
              </h3>
              <p className="text-[12px] text-[#6B7A99]">Daytime ground temperature vs city average (satellite)</p>
              <table className="mt-2 w-full text-left text-[14px]">
                <tbody className="divide-y divide-[#EEF2F7]" style={{ color: NAVY }}>
                  {hottestGround.slice(0, 8).map((z, i) => (
                    <tr key={z.zone_id}>
                      <td className="w-6 py-1.5 text-[#8A97B1]">{i + 1}</td>
                      <td className="py-1.5 font-semibold">{z.name}</td>
                      <td className="py-1.5 text-right text-[#6B7A99]">
                        {groundHeat(z.surface_temperature?.lst_day_anomaly_c).detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <footer className="mt-6 border-t border-[#EEF2F7] pt-3 text-[12px] leading-relaxed text-[#8A97B1]">
            Alert levels: AMC Heat Action Plan 2019 thresholds. Weather: Open-Meteo forecast (historical dates: archive and the
            airport station). HeatLens score: calibrated on real deaths in the May 2010 heatwave (one event). Ground heat: NASA
            MODIS, March–June 2022–2026. People: JRC population map, 2020. HeatLens prototype, SIH 2026 PS 26083 — not issued by
            or on behalf of AMC, IMD or any government body.
          </footer>
        </article>
      )}
    </div>
  )
}
