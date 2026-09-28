/**
 * The 5-day heat forecast, written so anyone can read it. Every value comes from the API:
 * - GET /forecast/{city}: day high, night low, the official AMC alert level (decided server-side
 *   from AMC Heat Action Plan 2019 thresholds), and the model numbers in "Detailed numbers";
 * - GET /risk/zones (one call per day): HeatLens heat stress in the most affected wards, the same
 *   figure the dashboard's outlook shows;
 * - GET /forecast/{city}/hourly (one call per day): "feels like" (heat index), the peak heat hours
 *   (UTCI of 38 °C or more) and daytime cloud cover for the sky picture.
 * Advice to residents: lib/advice.ts, the same list the dashboard and the residents' page show.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Clock, Moon, Sun, Thermometer } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { DEFAULT_CITY, useForecast, useHourlyMany, useRiskZonesMany, type ForecastDay, type HourlyResponse, type ZoneRisk } from '../api/hooks'
import { SkeletonBlock, ErrorMessage } from '../components/layout/StateMessage'
import WeatherIcon from '../components/dashboard/WeatherIcon'
import { AMC_LEVEL_NAME, AMC_THRESHOLD_C, HAP_COLOR, HAP_LEVELS, isHapLevel, type HapLevel } from '../lib/hap'
import { LEVEL_PLAIN, deathRisk, driverPlain, scoreDeaths } from '../lib/plain'
import { residentTips } from '../lib/advice'
import { BAND_ACCENT, dayMonth, hourLabel, skyWord, utciCategory, weekdayShort } from '../lib/dashboard'

const DASH = '—'
const deg = (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v)}°C`)
const NAVY = '#13265C'

/** Soft background for each level's card; the strong colour is HAP_COLOR. */
const LEVEL_TINT: Record<HapLevel, string> = {
  Green: '#F1F8F2',
  Yellow: '#FFF8E1',
  Orange: '#FFF1E6',
  Red: '#FDECEC',
}

function levelOf(d: ForecastDay): HapLevel | null {
  return d.hap_level && isHapLevel(d.hap_level) ? d.hap_level : null
}

function peakHours(h: HourlyResponse | undefined): string {
  if (!h) return DASH
  if (h.peak_start_hour == null || h.peak_end_hour == null) return 'None'
  return `${hourLabel(h.peak_start_hour)} – ${hourLabel(h.peak_end_hour)}`
}

/** HeatLens heat stress in the most affected wards: its band and how many wards share it. */
function wardStress(zones: ZoneRisk[] | undefined): { band: string; wards: number; total: number } | null {
  if (!zones?.length) return null
  const top = zones.reduce((a, b) => (b.calibrated_score > a.calibrated_score ? b : a))
  return { band: top.risk_band, wards: zones.filter((z) => z.risk_band === top.risk_band).length, total: zones.length }
}

function stressLine(st: ReturnType<typeof wardStress>): string {
  return st ? `${st.band} in ${st.wards} of ${st.total} wards` : DASH
}

function dayName(d: ForecastDay): string {
  return d.lead_day === 1 ? 'Tomorrow' : weekdayShort(d.date)
}

function Fact({
  icon: Icon,
  color,
  label,
  value,
  hint,
}: {
  icon: typeof Sun
  color: string
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/80 px-3 py-3 sm:gap-3 sm:px-4" title={hint}>
      <Icon className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" style={{ color }} strokeWidth={1.8} />
      <div className="min-w-0">
        <p className="text-[13px] text-[#3D4B6B]">{label}</p>
        <p className="text-[18px] sm:whitespace-nowrap sm:text-[22px] font-bold leading-tight" style={{ color: NAVY }}>
          {value}
        </p>
      </div>
    </div>
  )
}

export default function ForecastView() {
  const { data: forecast, isLoading, error, refetch } = useForecast(DEFAULT_CITY, 5)
  const dates = useMemo(() => forecast?.days.map((d) => d.date) ?? [], [forecast])
  const hourlyQ = useHourlyMany(DEFAULT_CITY, dates)
  const zonesQ = useRiskZonesMany(DEFAULT_CITY, dates)

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-6">
        <SkeletonBlock lines={12} />
      </div>
    )
  }

  if (error || !forecast) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-6">
        <ErrorMessage title="Could not load the weather forecast." error={error} onRetry={() => refetch()} />
      </div>
    )
  }

  const days = forecast.days
  const hourly = (i: number) => hourlyQ[i]?.data
  const stress = (i: number) => wardStress(zonesQ[i]?.data?.zones)
  const first = days[0]
  const firstLevel = first ? levelOf(first) : null
  const firstPlain = firstLevel ? LEVEL_PLAIN[firstLevel] : null
  const firstColor = firstLevel ? HAP_COLOR[firstLevel] : NAVY
  const alertDays = days.filter((d) => {
    const l = levelOf(d)
    return l != null && l !== 'Green'
  })
  const issued = new Date(forecast.issued_at)

  // Chart: each day from its night low to its day high; AMC alert lines drawn when in view.
  const chartData = days.map((d) => ({
    label: dayName(d),
    range: d.night_min_ta_c != null && d.ta_max_c != null ? [d.night_min_ta_c, d.ta_max_c] : null,
    high: d.ta_max_c,
    low: d.night_min_ta_c,
    color: levelOf(d) ? HAP_COLOR[levelOf(d) as HapLevel] : '#94A3B8',
  }))
  const highs = days.map((d) => d.ta_max_c).filter((v): v is number => v != null)
  const lows = days.map((d) => d.night_min_ta_c).filter((v): v is number => v != null)
  const yMin = lows.length ? Math.floor(Math.min(...lows) / 5) * 5 - 5 : 15
  const topHigh = highs.length ? Math.max(...highs) : 0
  // On a quiet week only the line where warnings start; the higher lines once a day gets close.
  const alertLines = (Object.keys(AMC_THRESHOLD_C) as (keyof typeof AMC_THRESHOLD_C)[]).filter(
    (k) => k === 'Yellow' || topHigh >= AMC_THRESHOLD_C.Yellow,
  )
  const yMax = Math.ceil(Math.max(topHigh, ...alertLines.map((k) => AMC_THRESHOLD_C[k])) / 5) * 5 + 5
  const yTicks = Array.from({ length: (yMax - yMin) / 5 + 1 }, (_, i) => yMin + i * 5)

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Title */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
            Heat forecast · next 5 days
          </h1>
          <p className="mt-1 text-[15px] text-[#3D4B6B]">How hot Ahmedabad will get, and what to do about it.</p>
        </div>
        <p className="text-[13px] text-[#6B7A99]">
          Updated{' '}
          {issued.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          })}
          ,{' '}
          {issued.toLocaleTimeString('en-GB', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}{' '}
          · Weather forecast from Open-Meteo
        </p>
      </div>

      {/* One-sentence summary of the week */}
      <div
        className="card px-5 py-4 text-[17px]"
        style={{ color: NAVY }}
      >
        {alertDays.length === 0 ? (
          <>
            <strong>No official heat alert in the next 5 days.</strong> Every day stays below 41.1 °C, the temperature at which
            the city starts issuing heat warnings.
          </>
        ) : (
          <>
            <strong>
              Heat alert on {alertDays.length} of the next {days.length} days:
            </strong>{' '}
            {alertDays.map((d) => `${dayName(d)} (${LEVEL_PLAIN[levelOf(d) as HapLevel].headline.toLowerCase()})`).join(', ')}.
          </>
        )}
      </div>

      {/* Tomorrow, big */}
      {first && (
        <section
          className="rounded-2xl border p-5 shadow-[0_1px_3px_rgba(19,38,92,0.05)]"
          style={{
            backgroundColor: firstLevel ? LEVEL_TINT[firstLevel] : '#FFFFFF',
            borderColor: `${firstColor}40`,
          }}
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="flex items-center gap-4">
              <WeatherIcon cloudPct={hourly(0)?.daytime_cloud_cover_pct} size={72} />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[#3D4B6B]">
                  Tomorrow · {weekdayShort(first.date)} {dayMonth(first.date)}
                  {skyWord(hourly(0)?.daytime_cloud_cover_pct) && ` · ${skyWord(hourly(0)?.daytime_cloud_cover_pct)}`}
                </p>
                <p
                  className="text-[30px] font-bold leading-tight"
                  style={{
                    color: firstLevel === 'Green' ? '#16A34A' : firstColor,
                  }}
                >
                  {firstPlain?.headline ?? DASH}
                </p>
                <p className="text-[14px] text-[#3D4B6B]" title={first.hap_basis ?? undefined}>
                  Official city alert (AMC): {firstLevel ? AMC_LEVEL_NAME[firstLevel] : DASH}
                </p>
                <p
                  className="text-[14px] text-[#3D4B6B]"
                  title="HeatLens heat-stress score in the most affected wards. It also counts humidity, sun and hot nights, so it can be high with no official alert."
                >
                  HeatLens heat stress:{' '}
                  <span className="font-semibold" style={{ color: stress(0) ? BAND_ACCENT[stress(0)!.band] : NAVY }}>
                    {stressLine(stress(0))}
                  </span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 min-[1500px]:grid-cols-4">
              <Fact
                icon={Thermometer}
                color="#EF4444"
                label="Hottest"
                value={deg(first.ta_max_c)}
                hint="Highest air temperature in the shade."
              />
              <Fact
                icon={Sun}
                color="#F97316"
                label="Feels like"
                value={deg(hourly(0)?.max_heat_index_c)}
                hint="Heat index: temperature and humidity together, in the shade."
              />
              <Fact
                icon={Moon}
                color="#4F46E5"
                label="Night cools to"
                value={deg(first.night_min_ta_c)}
                hint="Lowest air temperature during the night."
              />
              <Fact
                icon={Clock}
                color="#DC2626"
                label="Peak heat hours"
                value={peakHours(hourly(0))}
                hint={hourly(0)?.peak_rule ?? undefined}
              />
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[13px] font-bold uppercase tracking-wide text-[#6B7A99]">What you should do</p>
            <ul className="mt-2 flex flex-wrap gap-2.5">
              {residentTips(firstLevel, 'en', hourly(0)?.peak_start_hour != null).map((a) => (
                <li
                  key={a.key}
                  className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[15px] font-medium shadow-sm"
                  style={{ color: NAVY }}
                >
                  <a.icon className="h-5 w-5 text-[#1468D4]" strokeWidth={1.8} />
                  {a.text}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* The 5 days side by side */}
      <section>
        <h2 className="mb-3 text-[17px] font-semibold" style={{ color: NAVY }}>
          Day by day
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {days.map((d, i) => {
            const level = levelOf(d)
            const color = level ? HAP_COLOR[level] : '#94A3B8'
            const h = hourly(i)
            return (
              <div
                key={d.date}
                className="flex flex-col overflow-hidden card"
              >
                <div className="h-1.5" style={{ backgroundColor: color }} />
                <div className="flex flex-1 flex-col items-center px-3 pb-4 pt-3 text-center">
                  <p className="text-[17px] font-bold" style={{ color: NAVY }}>
                    {dayName(d)}
                  </p>
                  <p className="text-[13px] text-[#6B7A99]">{dayMonth(d.date)}</p>
                  <div className="my-2">
                    <WeatherIcon cloudPct={h?.daytime_cloud_cover_pct} size={52} />
                  </div>
                  <p className="text-[12px] text-[#6B7A99]">{skyWord(h?.daytime_cloud_cover_pct) ?? ' '}</p>
                  <p className="mt-1 text-[30px] font-bold leading-none" style={{ color: NAVY }}>
                    {deg(d.ta_max_c)}
                  </p>
                  <p className="mt-1 text-[13px] text-[#3D4B6B]">Night {deg(d.night_min_ta_c)}</p>
                  <span
                    className="mt-3 w-full rounded-lg px-2 py-1.5 text-[14px] font-semibold"
                    style={{
                      backgroundColor: level ? LEVEL_TINT[level] : '#F4F6FA',
                      color: level === 'Green' ? '#15803D' : level ? color : '#6B7A99',
                    }}
                    title={d.hap_basis ?? undefined}
                  >
                    {level ? LEVEL_PLAIN[level].headline : DASH}
                  </span>
                  <p
                    className="mt-1.5 text-[12px] font-medium"
                    style={{ color: stress(i) ? BAND_ACCENT[stress(i)!.band] : '#8A97B1' }}
                    title="HeatLens heat stress in the most affected wards (0–100 score band)."
                  >
                    {stress(i) ? `${stress(i)!.band} heat stress · ${stress(i)!.wards} wards` : zonesQ[i]?.isLoading ? 'Heat stress: loading…' : 'Heat stress: —'}
                  </p>
                  <dl className="mt-3 w-full space-y-1.5 text-[13px]">
                    <div
                      className="flex justify-between gap-2"
                      title="Heat index: temperature and humidity together, in the shade."
                    >
                      <dt className="text-[#6B7A99]">Feels like</dt>
                      <dd className="font-semibold" style={{ color: NAVY }}>
                        {deg(h?.max_heat_index_c)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2" title={h?.peak_rule ?? undefined}>
                      <dt className="text-[#6B7A99]">Peak heat</dt>
                      <dd className="text-right font-semibold" style={{ color: NAVY }}>
                        {peakHours(h)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Chart + colour guide */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card p-5">
          <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
            How hot each day gets
          </h2>
          <p className="text-[14px] text-[#3D4B6B]">
            Each bar runs from the coolest point of the night to the hottest point of the day, coloured by that day's alert.
            Dashed lines show where the city's heat alerts begin.
          </p>
          <div className="mt-3 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 22, right: 8, bottom: 0, left: -10 }}>
                <CartesianGrid vertical={false} stroke="#EEF2F7" />
                <XAxis dataKey="label" tick={{ fill: NAVY, fontSize: 13, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={[yMin, yMax]}
                  ticks={yTicks}
                  tick={{ fill: '#6B7A99', fontSize: 12 }}
                  tickFormatter={(v) => `${v}°`}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#F4F8FC' }}
                  formatter={(_v, _n, p) => [`${deg(p.payload.low)} at night → ${deg(p.payload.high)} in the day`, '']}
                  separator=""
                />
                {alertLines.map((k) => (
                  <ReferenceLine
                    key={k}
                    y={AMC_THRESHOLD_C[k]}
                    stroke={HAP_COLOR[k]}
                    strokeDasharray="5 4"
                    label={{
                      value:
                        k === 'Yellow' && alertLines.length === 1
                          ? `Heat warnings start · ${AMC_THRESHOLD_C[k]} °C`
                          : `${LEVEL_PLAIN[k].headline} · ${AMC_THRESHOLD_C[k]} °C`,
                      position: 'insideTopRight',
                      fill: HAP_COLOR[k],
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                ))}
                <Bar dataKey="range" radius={8} maxBarSize={46}>
                  {chartData.map((c) => (
                    <Cell key={c.label} fill={c.color} />
                  ))}
                  <LabelList
                    dataKey="high"
                    position="top"
                    formatter={(v) => deg(v as number)}
                    style={{ fill: NAVY, fontSize: 13, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
            What the colours mean
          </h2>
          <p className="text-[14px] text-[#3D4B6B]">The city's official heat alerts, set by the day's highest temperature.</p>
          <ul className="mt-3 space-y-2.5">
            {HAP_LEVELS.map((l) => (
              <li key={l} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: LEVEL_TINT[l] }}>
                <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: HAP_COLOR[l] }} />
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: NAVY }}>
                    {LEVEL_PLAIN[l].headline}
                  </p>
                  <p className="text-[13px] text-[#3D4B6B]">{LEVEL_PLAIN[l].meaning}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-[#8A97B1]">Source: Ahmedabad Municipal Corporation Heat Action Plan 2019.</p>
        </section>
      </div>

      {/* Full model numbers, folded away */}
      <details className="group card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
          <span>
            <span className="text-[17px] font-bold" style={{ color: NAVY }}>
              Detailed numbers
            </span>
            <span className="ml-2 text-[14px] text-[#6B7A99]">for health and city officials</span>
          </span>
          <ChevronDown className="h-5 w-5 text-[#6B7A99] transition group-open:rotate-180" />
        </summary>
        <div className="overflow-x-auto border-t border-[#EEF2F7]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-[#F7FAFE] text-[#3D4B6B]">
                <th className="px-4 py-3 font-semibold">Day</th>
                <th className="px-4 py-3 font-semibold" title="Highest air temperature (forecast).">
                  Air max
                </th>
                <th className="px-4 py-3 font-semibold" title="Lowest air temperature during the night.">
                  Night min
                </th>
                <th
                  className="px-4 py-3 font-semibold"
                  title="UTCI: how hot it feels to the body in the sun, counting wind and humidity."
                >
                  In the sun (UTCI)
                </th>
                <th
                  className="px-4 py-3 font-semibold"
                  title="WBGT: the outdoor-work safety measure (ISO 7243). 33 °C or more means rest only."
                >
                  Work safety (WBGT)
                </th>
                <th
                  className="px-4 py-3 font-semibold"
                  title="HeatLens 0–100 heat-stress score at the city-centre forecast point (23.03 N, 72.58 E), calibrated on real deaths in the May 2010 heatwave (one event). Wards in other forecast cells can score higher or lower: see Heat Stress."
                >
                  HeatLens score, city centre
                </th>
                <th
                  className="px-4 py-3 font-semibold"
                  title="Published Ahmedabad heatwave death-risk study (de Bont et al. 2024)."
                >
                  Death risk
                </th>
                <th className="px-4 py-3 font-semibold">Main cause of heat stress</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2F7]" style={{ color: NAVY }}>
              {days.map((d) => (
                <tr key={d.date}>
                  <td className="px-4 py-3 font-semibold">
                    {dayName(d)} <span className="font-normal text-[#6B7A99]">{dayMonth(d.date)}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{d.ta_max_c != null ? `${d.ta_max_c.toFixed(1)} °C` : DASH}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {d.night_min_ta_c != null ? `${d.night_min_ta_c.toFixed(1)} °C` : DASH}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {d.utci_max_c != null ? `${d.utci_max_c.toFixed(1)} °C` : DASH}
                    <span className="block text-[12px] text-[#6B7A99]">{utciCategory(d.utci_max_c)}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {d.wbgt_max_c != null ? `${d.wbgt_max_c.toFixed(1)} °C` : DASH}
                    {d.wbgt_max_c != null && (
                      <span className="block text-[12px] text-[#6B7A99]">
                        {d.wbgt_max_c >= 33 ? 'Rest only at peak' : 'Below rest-only level'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {d.calibrated_score.toFixed(0)} <span className="text-[12px] text-[#6B7A99]">({d.risk_band})</span>
                    <span className="block text-[12px] text-[#6B7A99]" title={scoreDeaths(d.score_mortality, d.calibrated_score).detail}>
                      {scoreDeaths(d.score_mortality, d.calibrated_score).word}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3"
                    title={d.health ? deathRisk(d.health.relative_risk, d.health.exposure_tier).detail : undefined}
                  >
                    {d.health ? deathRisk(d.health.relative_risk, d.health.exposure_tier).word : DASH}
                  </td>
                  <td className="px-4 py-3">{driverPlain(d.dominant_driver)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/?date=${d.date}`}
                      className="inline-flex items-center gap-1 font-semibold text-[#1468D4] hover:underline"
                    >
                      Open
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[#EEF2F7] px-5 py-3 text-[12px] text-[#6B7A99]">
          These are forecasts, not measurements. How past forecasts compared with the Ahmedabad airport weather station is shown
          on the Methods page.
        </p>
      </details>
    </div>
  )
}
