/**
 * Methods & evidence — IMPLEMENTATION_PLAN.md §6.2, §7. The credibility page:
 * "is this validated?" answered with a URL rather than a scramble.
 *
 * Everything here is fetched from /validation/*, which reads the repo's own
 * artefacts (results/benchmark_report.md, backend/rules/evidence_ledger.toml,
 * the health-model description), so this page cannot drift from what the code
 * and the report actually say.
 */
import type { ReactNode } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { useEvidenceLedger, useValidationStatus } from '../api/hooks'
import type { LedgerEntry, ValidationStatus } from '../api/hooks'
import { ErrorMessage, SkeletonBlock } from '../components/layout/StateMessage'

const STATUS_STYLE: Record<LedgerEntry['status'], { label: string; className: string }> = {
  MEASURED_POINT: {
    label: 'Measured',
    className: 'bg-emerald-100 text-emerald-800',
  },
  MEASURED_CENSUS: {
    label: 'Measured (Census)',
    className: 'bg-emerald-100 text-emerald-800',
  },
  MEASURED_FORECAST: {
    label: 'Measured (forecast)',
    className: 'bg-emerald-100 text-emerald-800',
  },
  MEASURED_GEODATA: {
    label: 'Measured (open geodata)',
    className: 'bg-emerald-100 text-emerald-800',
  },
  MEASURED_SATELLITE: {
    label: 'Measured (satellite)',
    className: 'bg-emerald-100 text-emerald-800',
  },
  MODELLED_PUBLISHED: { label: 'Published source', className: 'bg-sky-100 text-sky-800' },
  MODELLED_CALIBRATED: {
    label: 'Calibrated (May 2010 deaths)',
    className: 'bg-teal-100 text-teal-800',
  },
  MODELLED_UNCALIBRATED: {
    label: 'Uncalibrated',
    className: 'bg-amber-100 text-amber-800',
  },
  ILLUSTRATIVE: { label: 'Illustrative', className: 'bg-violet-100 text-violet-800' },
  NOT_AVAILABLE: {
    label: 'Not available',
    className: 'bg-[#E9EEF5] text-[#3D4B6B]',
  },
}

// Friendly headings for the columns pandas printed into results/benchmark_report.md.
const COLUMN_LABEL: Record<string, string> = {
  index: 'Index',
  may2010_mean: 'May 2010 mean',
  all_may_mean: 'All-May mean',
  may2010_rank: 'May 2010 rank',
  spearman_rho: 'Spearman ρ',
  p_value: 'p-value',
  flagged_days: 'Days flagged',
  imd_hw_days: 'IMD heat-wave days',
  false_alarm_rate: 'False-alarm rate',
  missed_event_rate: 'Missed-event rate',
}

// Plain names for the index rows of results/benchmark_report.md (the report keeps its own names;
// a test checks its numbers verbatim).
const INDEX_LABEL: Record<string, string> = {
  'PHD (Plan C)': 'Heat debt (PHD)',
  'HTSI basic': 'HTSI, basic',
  'HTSI+UTCI': 'HTSI + UTCI',
  'HTSI+X (dry-heat)': 'HTSI + dry heat',
  'HTSI+UTCI+X (full)': 'HTSI, full',
}

/** The report's text is Markdown; show it as plain prose rather than with literal asterisks. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

/** The report prints 4 decimals; a p-value of 0.0000 must read "< 0.001", not "0". */
function formatCell(column: string, v: number | string): string {
  if (typeof v !== 'number') return INDEX_LABEL[v] ?? plain(v)
  if (column === 'p_value') return v < 0.001 ? '< 0.001' : v.toFixed(3)
  if (column === 'spearman_rho' || column.endsWith('_rate')) return v.toFixed(3)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

const NAVY = '#13265C'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** The ledger's statuses in four plain groups, for the summary at the top of the page. */
const GROUPS: { title: string; sub: string; color: string; bg: string; statuses: LedgerEntry['status'][] }[] = [
  {
    title: 'Measured',
    sub: 'Weather, satellite, census and station data',
    color: '#15803D',
    bg: '#F0FDF4',
    statuses: ['MEASURED_POINT', 'MEASURED_CENSUS', 'MEASURED_FORECAST', 'MEASURED_GEODATA', 'MEASURED_SATELLITE'],
  },
  {
    title: 'Published science',
    sub: 'Standards and peer-reviewed studies, used as published',
    color: '#0369A1',
    bg: '#F0F9FF',
    statuses: ['MODELLED_PUBLISHED'],
  },
  {
    title: 'Our own model',
    sub: 'Built by HeatLens; the score is calibrated on May 2010 deaths',
    color: '#B45309',
    bg: '#FFFBEB',
    statuses: ['MODELLED_UNCALIBRATED', 'MODELLED_CALIBRATED', 'ILLUSTRATIVE'],
  },
  {
    title: 'Not built yet',
    sub: 'Never shown as live anywhere in the app',
    color: '#475569',
    bg: '#F8FAFC',
    statuses: ['NOT_AVAILABLE'],
  },
]

interface Calibration {
  data: { n_days: number; deaths_total: number; source: string; period: string[] }
  extra_deaths_pct_per_10_points: number
  calibrated_range: [number, number]
  curve: { score: number; death_ratio: number; ci_low: number; ci_high: number }[]
  days: { date: string; score: number; deaths: number; reference: number; death_ratio: number }[]
  comparison: {
    measure: string
    timing: string
    loo_mae_deaths_per_day: number
    spearman_with_death_ratio: number
    used_for_calibration: boolean
  }[]
  best_same_day_measure: string
  limitations: string[]
}

function ScoreCalibration({ cal }: { cal: Calibration }) {
  const [lo, hi] = cal.calibrated_range
  const curve = cal.curve.map((c) => ({ score: c.score, fit: c.death_ratio, band: [c.ci_low, c.ci_high] }))
  const points = cal.days.map((d) => ({ score: d.score, observed: d.death_ratio, date: d.date }))
  const best = Math.min(...cal.comparison.map((c) => c.loo_mae_deaths_per_day))
  return (
    <div className="space-y-4">
      <p className="text-[15px] leading-relaxed text-[#3D4B6B]">
        Each dot is one real day of May 2010: its HeatLens score, and how many people died compared with the same day in a normal
        year. The line is the fitted calibration.{' '}
        <strong style={{ color: NAVY }}>
          Each +10 points of score meant about +{Math.round(cal.extra_deaths_pct_per_10_points)}% deaths
        </strong>
        , for scores {lo}–{hi}. Outside that range the app gives no death estimate.
      </p>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
            <CartesianGrid stroke="#EEF2F7" />
            <XAxis
              type="number"
              dataKey="score"
              domain={[lo - 1, hi + 1]}
              tick={{ fill: '#6B7A99', fontSize: 12 }}
              label={{ value: 'HeatLens score', position: 'insideBottom', offset: -4, fill: '#6B7A99', fontSize: 12 }}
            />
            <YAxis
              type="number"
              domain={[0.5, 3]}
              ticks={[0.5, 1, 1.5, 2, 2.5, 3]}
              tickFormatter={(v: number) => `×${v}`}
              tick={{ fill: '#6B7A99', fontSize: 12 }}
            />
            <Tooltip
              formatter={(v, n) => [
                Array.isArray(v) ? `×${v[0]}–×${v[1]}` : `×${Number(v).toFixed(2)}`,
                n === 'observed' ? 'Deaths vs normal (real day)' : n === 'fit' ? 'Fitted' : '95% range',
              ]}
              labelFormatter={(l) => `Score ${l}`}
            />
            <Area data={curve} dataKey="band" stroke="none" fill="#14B8A6" fillOpacity={0.15} isAnimationActive={false} />
            <Line data={curve} dataKey="fit" stroke="#0F766E" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Scatter data={points} dataKey="observed" fill="#DC2626" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#EEF2F7]">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead>
            <tr className="bg-[#F7FAFE] text-[12px] uppercase tracking-wide text-[#6B7A99]">
              <th className="px-3 py-2 font-semibold">Measure</th>
              <th className="px-3 py-2 font-semibold">Heat on</th>
              <th className="px-3 py-2 font-semibold" title="Leave-one-day-out: each day predicted by a fit on the other 30.">
                Error on unseen days
              </th>
              <th className="px-3 py-2 font-semibold">Rank agreement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF2F7]" style={{ color: NAVY }}>
            {cal.comparison.map((c) => (
              <tr key={c.measure + c.timing} className={c.used_for_calibration ? 'bg-[#F0FDFA]' : ''}>
                <td className="px-3 py-2 font-semibold">
                  {c.measure}
                  {c.used_for_calibration && (
                    <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] text-teal-800">used</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[#3D4B6B]">{c.timing}</td>
                <td className={`px-3 py-2 tabular-nums ${c.loo_mae_deaths_per_day === best ? 'font-bold text-[#15803D]' : ''}`}>
                  {c.loo_mae_deaths_per_day} deaths/day
                </td>
                <td className="px-3 py-2 tabular-nums">{c.spearman_with_death_ratio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-[#3D4B6B]">
        Best on same-day heat: <strong>{cal.best_same_day_measure}</strong>. The HeatLens score is about as good as a real
        thermometer on these days, and slightly better when the day before is counted (a check made after the fit, so not used).
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6B7A99]">
        {cal.limitations.map((l) => (
          <li key={l}>{plain(l)}</li>
        ))}
      </ul>
      <p className="text-[12px] text-[#8A97B1]">Data: {cal.data.source}.</p>
    </div>
  )
}

function LedgerSummary() {
  const { data } = useEvidenceLedger()
  if (!data) return null
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {GROUPS.map((g) => {
        const rows = data.entries.filter((e) => g.statuses.includes(e.status))
        return (
          <div key={g.title} className="rounded-2xl border border-[#E3EBF5] p-4" style={{ backgroundColor: g.bg }}>
            <p className="text-[30px] font-bold leading-none" style={{ color: g.color }}>
              {rows.length}
              <span className="ml-1 text-[14px] font-medium text-[#6B7A99]">of {data.entries.length}</span>
            </p>
            <p className="mt-1 text-[16px] font-bold" style={{ color: NAVY }}>
              {g.title}
            </p>
            <p className="text-[13px] text-[#6B7A99]">{g.sub}</p>
          </div>
        )
      })}
    </div>
  )
}

function StatusChip({ status }: { status: LedgerEntry['status'] }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
  )
}

function Ledger() {
  const { data, isLoading, error, refetch } = useEvidenceLedger()
  if (isLoading) return <SkeletonBlock lines={8} />
  if (error || !data) return <ErrorMessage error={error} title="Could not load the evidence ledger." onRetry={() => refetch()} />

  return (
    <div className="overflow-x-auto rounded-lg border border-[#E4EAF3]">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[#E4EAF3] bg-[#F8FAFD] text-left text-[11px] uppercase tracking-wide text-[#6B7A99]">
            <th className="w-[26%] px-4 py-2.5 font-semibold">What</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">Source and what it means</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr
              key={e.component}
              className={`border-b border-[#EEF2F7] align-top last:border-0 ${
                e.status === 'NOT_AVAILABLE' ? 'bg-[#F8FAFD]' : ''
              }`}
            >
              <td className="px-4 py-3 font-semibold text-[#13265C]">{e.title ?? e.component}</td>
              <td className="px-4 py-3">
                <StatusChip status={e.status} />
              </td>
              <td className="px-4 py-3 text-[13px] leading-relaxed text-[#3D4B6B]">
                <p>{e.basis}</p>
                <p className="mt-1 text-[#6B7A99]">{e.note}</p>
                {e.code.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1">
                    {e.code.map((f) => (
                      <code key={f} className="rounded bg-[#F1F4F9] px-1.5 py-px font-mono text-[11px] text-[#51607F]">
                        {f}
                      </code>
                    ))}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BenchmarkTables({ status }: { status: ValidationStatus }) {
  return (
    <div className="space-y-6">
      {status.benchmark.tables.map((t) => (
        <div key={t.key}>
          <h3 className="text-sm font-medium">{t.title}</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[#E4EAF3]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4EAF3] bg-[#F8FAFD] text-left text-xs text-[#6B7A99]">
                  {t.columns.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium">
                      {COLUMN_LABEL[c] ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row) => (
                  <tr
                    key={String(row[t.columns[0]])}
                    className="border-b border-[#EEF2F7] last:border-0"
                  >
                    {t.columns.map((c, i) => {
                      const v = row[c]
                      const isRank = c === 'may2010_rank'
                      return (
                        <td
                          key={c}
                          className={`px-3 py-1.5 ${i === 0 ? 'font-medium' : 'tabular-nums'} ${
                            isRank && Number(v) <= 2 ? 'font-semibold text-emerald-700' : ''
                          } ${isRank && Number(v) >= 6 ? 'font-semibold text-red-700' : ''}`}
                        >
                          {formatCell(c, v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function HealthModel({ status }: { status: ValidationStatus }) {
  const m = status.health_model
  return (
    <div className="space-y-4 text-sm">
      <p>{m.definition}</p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-[#6B7A99]">Threshold</dt>
        <dd>
          <span className="font-semibold tabular-nums">{m.threshold_p97_c.toFixed(1)} °C</span>{' '}
          <span className="text-[#6B7A99]">— {m.threshold_basis}</span>
        </dd>
        <dt className="text-[#6B7A99]">Base effect</dt>
        <dd>
          <span className="font-semibold tabular-nums">+{m.base_effect_pct}%</span> daily mortality (95% CI {m.base_ci_pct[0]}–
          {m.base_ci_pct[1]}), Ahmedabad
        </dd>
        <dt className="text-[#6B7A99]">Intensity slope</dt>
        <dd>
          +{m.intensity_slope_pct_per_pct}% per 1% above the threshold (95% CI {m.intensity_slope_ci[0]}–{m.intensity_slope_ci[1]}
          ), centred on the study mean of {m.intensity_centre_pct}%
        </dd>
        <dt className="text-[#6B7A99]">MRI (0–100)</dt>
        <dd>{m.mri_definition}</dd>
      </dl>

      <div>
        <h3 className="font-medium">How well does this data reproduce the study's own heatwave definition?</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-[#E4EAF3]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E4EAF3] bg-[#F8FAFD] text-left text-xs text-[#6B7A99]">
                <th className="px-3 py-2 font-medium">Measure</th>
                <th className="px-3 py-2 font-medium">Published</th>
                <th className="px-3 py-2 font-medium">Reproduced here</th>
              </tr>
            </thead>
            <tbody>
              {m.reference_stats.map((s) => (
                <tr key={s.name} className="border-b border-[#EEF2F7] last:border-0">
                  <td className="px-3 py-1.5">{s.name}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {s.published} <span className="text-[#8A97B1]">{s.unit}</span>
                  </td>
                  <td className="px-3 py-1.5 font-semibold tabular-nums">
                    {s.reproduced} <span className="font-normal text-[#8A97B1]">{s.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[#6B7A99]">
          One point series versus the study's ERA5 grid mean: heatwave counts fall a little short, while the quantity the modifier
          is centred on (intensity) matches closely.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="font-medium">Where this departs from the source</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-[#51607F]">
            {m.deviations.map((d) => (
              <li key={d}>{plain(d)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-medium">Deliberately not modelled</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-[#51607F]">
            {m.not_modelled.map((d) => (
              <li key={d}>{plain(d)}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-xs text-[#6B7A99]">Source: {m.citation}</p>
    </div>
  )
}

type Verification = NonNullable<ValidationStatus['station_verification']>
type Score = Verification['history']

function ScoreRow({ label, s }: { label: string; s: Score }) {
  return (
    <tr className="border-b border-[#EEF2F7] last:border-0">
      <td className="px-3 py-1.5 font-medium">{label}</td>
      <td className="px-3 py-1.5 tabular-nums">{s.n_days}</td>
      <td className="px-3 py-1.5 tabular-nums">
        {s.bias_c > 0 ? '+' : ''}
        {s.bias_c.toFixed(2)} °C
      </td>
      <td className="px-3 py-1.5 tabular-nums">{s.mae_c.toFixed(2)} °C</td>
      <td className="px-3 py-1.5 tabular-nums">{s.pearson_r.toFixed(3)}</td>
      <td className="px-3 py-1.5 tabular-nums">{s.amc_level_agreement_pct.toFixed(1)}%</td>
      <td className="px-3 py-1.5 tabular-nums">
        {s.station_alert_days_model_missed} of {s.station_alert_days}
      </td>
    </tr>
  )
}

function StationCheck({ v }: { v: Verification }) {
  return (
    <div className="space-y-3 text-sm">
      <p>
        Daily maximum temperature from HeatLens&apos;s inputs, compared with what the {v.station_name} thermometer recorded (
        {v.source}, {v.season}, retrieved {v.retrieved}). Bias is model minus station. &ldquo;Alert days missed&rdquo; counts days
        the station was at AMC Yellow or above while the model said no alert.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[#E4EAF3]">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[#E4EAF3] bg-[#F8FAFD] text-left text-xs text-[#6B7A99]">
              <th className="px-3 py-2 font-medium">Input</th>
              <th className="px-3 py-2 font-medium">Days</th>
              <th className="px-3 py-2 font-medium">Bias</th>
              <th className="px-3 py-2 font-medium">Mean abs. error</th>
              <th className="px-3 py-2 font-medium">Correlation</th>
              <th className="px-3 py-2 font-medium">AMC level match</th>
              <th className="px-3 py-2 font-medium">Alert days missed</th>
            </tr>
          </thead>
          <tbody>
            <ScoreRow label="History (reanalysis)" s={v.history} />
            {Object.entries(v.forecast_leads)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([lead, s]) => (
                <ScoreRow key={lead} label={`Forecast, ${lead} day${lead === '1' ? '' : 's'} ahead`} s={s} />
              ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#6B7A99]">
        {v.history_model}. {v.forecast_model}. Because the reanalysis runs cool against the station, a historical date&apos;s AMC
        alert level uses the station&apos;s own measured maximum wherever one exists.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-[#51607F]">
        {v.caveats.map((c) => (
          <li key={c}>{plain(c)}</li>
        ))}
      </ul>
    </div>
  )
}

export default function MethodsView() {
  const { data, isLoading, error, refetch } = useValidationStatus()

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: NAVY }}>
          Where the numbers come from
        </h1>
        <p className="mt-1 text-[15px] text-[#3D4B6B]">
          Every claim HeatLens makes, and whether it is measured, taken from published science, our own model, or not built yet.
        </p>
      </div>
      <LedgerSummary />

      {isLoading && (
        <div>
          <SkeletonBlock lines={6} />
        </div>
      )}
      {error && <ErrorMessage error={error} title="Could not load the validation status." onRetry={() => refetch()} />}

      {data && (
        <>
          <div
            role="note"
            className={`rounded-2xl border p-4 ${
              data.index_calibrated_against_health_outcomes
                ? 'border-[#CDE9D5] bg-[#F3FAF4]'
                : 'border-amber-300 bg-amber-50'
            }`}
          >
            <p className="font-semibold">
              {data.index_calibrated_against_health_outcomes
                ? 'A comparison against real health outcomes has been run.'
                : "HeatLens's indices have not been tested against health outcomes."}
            </p>
            <p className="mt-1 text-sm text-[#3D4B6B]">{data.reason}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#E3EBF5] bg-white p-4">
              <h2 className="text-sm font-semibold">What was tested</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-[#3D4B6B]">
                {data.what_was_tested.map((t) => (
                  <li key={t}>{plain(t)}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[#E3EBF5] bg-white p-4">
              <h2 className="text-sm font-semibold">What was not tested</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-[#3D4B6B]">
                {data.what_was_not_tested.map((t) => (
                  <li key={t}>{plain(t)}</li>
                ))}
              </ul>
            </div>
          </div>

          {data.score_calibration && (
            <Section title="The HeatLens score, checked against real deaths">
              <ScoreCalibration cal={data.score_calibration as unknown as Calibration} />
            </Section>
          )}

          <Section title="Evidence ledger">
            <p className="mb-3 text-sm text-[#6B7A99]">
              One row per claim. A “Not available” row is not shown as live anywhere in the product. File names show where
              each item lives in the code.
            </p>
            <Ledger />
          </Section>

          {data.station_verification && (
            <Section title="Temperature inputs against a real thermometer">
              <StationCheck v={data.station_verification} />
            </Section>
          )}

          <Section title="Mortality risk: how the published study is applied">
            <HealthModel status={data} />
          </Section>

          <Section title="Structural benchmark, 2010–2024">
            <p className="mb-4 text-sm text-[#6B7A99]">{plain(data.benchmark.scope)}</p>
            <BenchmarkTables status={data} />
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-[#51607F]">
              {data.benchmark.limitations.map((l) => (
                <li key={l}>{plain(l)}</li>
              ))}
            </ul>
          </Section>

          <Section title="Validation against health outcomes">
            {data.outcome_validation.status === 'not_run' ? (
              <div className="text-sm">
                <p>
                  Not run. The one thing that would turn this from an uncalibrated model into a tested claim is a daily mortality
                  or admissions series. When one is obtained, this single command runs the comparison and publishes the result to
                  this page, <strong>whatever the result</strong>:
                </p>
                <pre className="mt-2 overflow-x-auto rounded-md bg-[#F1F4F9] p-3 text-xs">
                  {data.outcome_validation.how_to_run}
                </pre>
                <p className="mt-2 text-xs text-[#6B7A99]">
                  A run on synthetic data is stamped “not evidence” and refused publication, so it can never appear here.
                </p>
              </div>
            ) : (
              <div className="text-sm">
                <p>
                  Data: <strong>{data.outcome_validation.data_source}</strong>
                </p>
                <p className="text-[#6B7A99]">{data.outcome_validation.evidence_status}</p>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-[#F1F4F9] p-3 text-xs">
                  {JSON.stringify(data.outcome_validation.report, null, 2)}
                </pre>
              </div>
            )}
          </Section>

          <p className="text-xs text-[#8A97B1]">
            Back to the{' '}
            <Link to="/" className="underline hover:text-[#51607F]">
              dashboard
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}
