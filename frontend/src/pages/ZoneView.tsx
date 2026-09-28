/**
 * One ward in depth, in plain words: today's heat (WardPanel), how the last days built up, what
 * drives the score, the health risk, and the model detail for officials. Every value comes from
 * GET /risk/zones/{zone}: on live dates the history is this ward's own forecast grid cell; on
 * historical dates it is the city-level record (ZoneRisk.weather_basis says which).
 */
import { useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, HeartPulse, MessageSquare, Smartphone } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DEFAULT_CITY, useForecast, useZoneDetail } from '../api/hooks'
import WardPanel from '../components/dashboard/WardPanel'
import HealthCard from '../components/health/HealthCard'
import { EmptyState, ErrorMessage, SkeletonBlock } from '../components/layout/StateMessage'
import { longDate } from '../lib/dates'
import { deathRisk, driverPlain } from '../lib/plain'
import { dayMonth, scoreColor } from '../lib/dashboard'
import { weatherBasisShort } from '../lib/surface'

const NAVY = '#13265C'
const CARD = 'card'

export default function ZoneView() {
  const { zoneId } = useParams<{ zoneId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const requested = params.get('date')
  const forecast = useForecast(DEFAULT_CITY, 5)
  const date = requested ?? forecast.data?.issue_date ?? ''
  const { data, isLoading, error, refetch } = useZoneDetail(zoneId ?? null, DEFAULT_CITY, date, 30)

  const z = data?.zone
  const history = useMemo(
    () =>
      (data?.history ?? []).map((h) => ({
        day: dayMonth(h.date),
        score: h.calibrated_score,
        night: h.night_min_ta_c,
      })),
    [data],
  )
  const parts = z ? Object.entries(z.component_breakdown).sort((a, b) => b[1] - a[1]) : []
  const partTotal = parts.reduce((s, [, v]) => s + v, 0) || 1
  const risk = z ? deathRisk(z.health.relative_risk, z.health.exposure_tier) : null

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[14px] font-semibold text-[#1468D4] hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {!date && !forecast.isLoading && (
        <EmptyState title="No date selected">Open a ward from the map so it arrives with a date.</EmptyState>
      )}
      {(isLoading || (!date && forecast.isLoading)) && <SkeletonBlock lines={10} />}
      {error && <ErrorMessage error={error} title="Could not load this ward." onRetry={() => refetch()} />}

      {z && data && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
                {z.name}
              </h1>
              <p className="text-[15px] text-[#3D4B6B]">{longDate(date)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/advisory/${zoneId}?date=${date}`}
                className="flex items-center gap-2 rounded-xl bg-[#13265C] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#0E1D49]"
              >
                <MessageSquare className="h-4 w-4" /> Advice for this area
              </Link>
              <Link
                to={`/public/${zoneId}?date=${date}`}
                className="flex items-center gap-2 rounded-xl border border-[#DCE6F2] bg-white px-4 py-2.5 text-[14px] font-semibold shadow-sm hover:bg-[#F7FAFE]"
                style={{ color: NAVY }}
              >
                <Smartphone className="h-4 w-4" /> Residents’ page
              </Link>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            {/* Today, in plain words */}
            <div className="lg:h-[760px]">
              <WardPanel zone={z} date={date} detailsLink={false} />
            </div>

            <div className="space-y-4">
              {/* Last days */}
              <section className={`${CARD} p-5`}>
                <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
                  The last few days
                </h2>
                <p className="text-[13px] text-[#6B7A99]">
                  HeatLens heat-stress score (0–100) for each day, and how cool that night got. Hot nights let heat build up in
                  the body.
                </p>
                <div className="mt-3 h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={history} margin={{ top: 22, right: 4, bottom: 0, left: -18 }}>
                      <CartesianGrid vertical={false} stroke="#EEF2F7" />
                      <XAxis
                        dataKey="day"
                        interval={0}
                        tick={({ x, y, payload, index }) => (
                          <g transform={`translate(${x},${y})`}>
                            <text dy={12} textAnchor="middle" fill="#3D4B6B" fontSize={12} fontWeight={600}>
                              {payload.value}
                            </text>
                            <text dy={28} textAnchor="middle" fill="#4F46E5" fontSize={11}>
                              {history[index]?.night != null ? `Night ${Math.round(history[index].night as number)}°` : ''}
                            </text>
                          </g>
                        )}
                        height={40}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tick={{ fill: '#6B7A99', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip formatter={(v) => [Number(v).toFixed(0), 'HeatLens score']} cursor={{ fill: '#F4F8FC' }} />
                      <Bar dataKey="score" radius={[6, 6, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                        {history.map((h) => (
                          <Cell key={h.day} fill={scoreColor(h.score)} />
                        ))}
                        <LabelList
                          dataKey="score"
                          position="top"
                          formatter={(v) => Number(v).toFixed(0)}
                          style={{ fill: NAVY, fontSize: 12, fontWeight: 700 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[12px] text-[#8A97B1]" title={z.weather_basis ?? undefined}>
                  {weatherBasisShort(z.weather_basis)}
                </p>
              </section>

              {/* What drives the score */}
              <section className={`${CARD} p-5`}>
                <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
                  What makes it hot today
                </h2>
                <p className="text-[13px] text-[#6B7A99]">How much each cause adds to the HeatLens score.</p>
                <div className="mt-3 space-y-2.5">
                  {parts.map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-[14px]" style={{ color: NAVY }}>
                        <span className={k === z.dominant_driver ? 'font-bold' : ''}>{driverPlain(k)}</span>
                        <span className="tabular-nums text-[#6B7A99]">{Math.round((v / partTotal) * 100)}%</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[#EEF2F7]">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${(v / partTotal) * 100}%`,
                            backgroundColor: k === z.dominant_driver ? '#F97316' : '#94A3B8',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Health */}
              <section className={`${CARD} p-5`}>
                <h2 className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: NAVY }}>
                  <HeartPulse className="h-5 w-5 text-[#DC2626]" /> Health risk for the city
                </h2>
                <p className="mt-1 text-[17px] font-semibold" style={{ color: NAVY }}>
                  {risk?.word}
                </p>
                <p className="text-[13px] text-[#6B7A99]">{risk?.detail}</p>
              </section>
            </div>
          </div>

          {/* Officials' detail */}
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
                <HealthCard health={z.health} />
              </div>
              <div className="space-y-4 text-[14px]" style={{ color: NAVY }}>
                <div>
                  <p className="font-bold">Body heat build-up (HeatLens heat-debt model, not calibrated)</p>
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
                    <dt className="text-[#6B7A99]">Outdoor worker</dt>
                    <dd className="tabular-nums">{data.debt.debt_worker?.toFixed(1) ?? '—'}</dd>
                    <dt className="text-[#6B7A99]">Older person</dt>
                    <dd className="tabular-nums">{data.debt.debt_elderly?.toFixed(1) ?? '—'}</dd>
                    <dt className="text-[#6B7A99]">Hours over the core-temperature limit (worker)</dt>
                    <dd className="tabular-nums">{data.debt.worker_hours_rectal_ge_limit ?? '—'}</dd>
                    <dt className="text-[#6B7A99]">Hours inside the ISO 7933 validity range</dt>
                    <dd className="tabular-nums">
                      {data.debt.iso7933_in_range_frac != null ? `${Math.round(data.debt.iso7933_in_range_frac * 100)}%` : '—'}
                    </dd>
                  </dl>
                  {data.debt.iso7933_in_range_frac != null && data.debt.iso7933_in_range_frac < 1 && (
                    <p className="mt-1 text-[12px] text-[#B45309]">
                      The model ran partly outside its validated range on this date.
                    </p>
                  )}
                </div>
                <div>
                  <p className="font-bold">People</p>
                  <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
                    <dt className="text-[#6B7A99]">Population (2020 model)</dt>
                    <dd className="tabular-nums">{z.exposure.population_count?.toLocaleString('en-IN') ?? '—'}</dd>
                    <dt className="text-[#6B7A99]">People per km²</dt>
                    <dd className="tabular-nums">{z.exposure.population_density_per_km2?.toLocaleString('en-IN') ?? '—'}</dd>
                    <dt className="text-[#6B7A99]">Aged 60+ (district urban share)</dt>
                    <dd className="tabular-nums">{z.exposure.elderly_share_pct}%</dd>
                  </dl>
                  <p className="mt-1 text-[12px] text-[#8A97B1]">{z.exposure.elderly_share_basis}</p>
                  <p className="mt-1 text-[12px] text-[#8A97B1]">{z.exposure.population_status}</p>
                </div>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
