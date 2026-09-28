import { useId } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Clock } from 'lucide-react'
import type { HourlyResponse } from '../../api/hooks'
import { UTCI_STEPS, WBGT_REST_ONLY_C, hourLabel, restOnlyRun, utciColor } from '../../lib/dashboard'

interface Props {
  /** 'utci' (heat stress in the sun, default) or 'wbgt' (outdoor work safety). */
  metric?: 'utci' | 'wbgt'
  data: HourlyResponse | undefined
  loading: boolean
  error?: Error | null
  day: 'today' | 'tomorrow'
  onDayChange: (d: 'today' | 'tomorrow') => void
}

/**
 * Hour-by-hour heat stress in the sun for one day (UTCI, °C - GET /forecast/{city}/hourly). The
 * line is coloured by the published UTCI stress scale; the shaded block is the peak danger period
 * (UTCI >= 38 °C). A forecast/archive series for the city, not a live sensor feed.
 */
export default function HeatExposureChart({ metric = 'utci', data, loading, error, day, onDayChange }: Props) {
  const gid = useId().replace(/:/g, '')
  const isWbgt = metric === 'wbgt'
  const points = (data?.points ?? [])
    .map((p) => ({ hour: p.hour, v: isWbgt ? p.wbgt_c : p.utci_c }))
    .filter((p): p is { hour: number; v: number } => p.v != null)
    .map((p) => ({ hour: p.hour, utci: p.v }))
  const values = points.map((p) => p.utci)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const yMax = Math.max(isWbgt ? 40 : 50, Math.ceil((hi + 2) / 10) * 10)
  const yMin = Math.min(isWbgt ? 10 : 10, Math.floor((lo - 2) / 10) * 10)

  // Vertical gradient over the line's own extent: each UTCI band gets its colour.
  const stops: { offset: number; color: string }[] = []
  if (hi > lo && !isWbgt) {
    const off = (v: number) => Math.min(1, Math.max(0, (hi - v) / (hi - lo)))
    const edges = [...UTCI_STEPS].reverse() // ascending
    for (let i = 0; i < edges.length; i++) {
      const from = i === 0 ? lo : edges[i].min
      const to = i + 1 < edges.length ? edges[i + 1].min : hi
      if (to <= lo || from >= hi) continue
      stops.push({ offset: off(Math.min(to, hi)), color: edges[i].color })
      stops.push({ offset: off(Math.max(from, lo)), color: edges[i].color })
    }
    stops.sort((a, b) => a.offset - b.offset)
  }

  // UTCI: the backend's peak period (UTCI >= 38). WBGT: the continuous run of hours at or above
  // the 33 °C "rest only" limit around the day's highest WBGT.
  const wbgtRun = isWbgt ? restOnlyRun(points.map((p) => ({ hour: p.hour, v: p.utci }))) : null
  const peak = isWbgt
    ? wbgtRun
    : data?.peak_start_hour != null && data?.peak_end_hour != null
      ? { start: data.peak_start_hour, end: data.peak_end_hour }
      : null

  return (
    <section className="flex h-full flex-col card p-5 xl:min-h-0 xl:p-4 [@media(min-height:960px)]:xl:p-5">
      <div className="flex flex-wrap items-center xl:flex-nowrap justify-between gap-3">
        <h2 className="flex items-center gap-2 whitespace-nowrap text-[16px] font-semibold text-[#13265C]">
          <Clock className="h-[18px] w-[18px] text-[#8A97B1]" strokeWidth={1.9} />
          {isWbgt ? 'Work safety through the day' : 'Heat stress through the day'}
        </h2>
        <select
          value={day}
          onChange={(e) => onDayChange(e.target.value as 'today' | 'tomorrow')}
          className="min-w-0 max-w-full rounded-lg border border-[#E4EAF3] bg-white px-2.5 py-1.5 text-[13px] text-[#13265C] xl:max-w-[170px]"
        >
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
        </select>
      </div>

      <div className="mt-3 min-h-[250px] flex-1 xl:min-h-0">
        {loading && <p className="p-4 text-sm text-[#6B7A99]">Loading…</p>}
        {!loading && error && (
          <p className="p-4 text-sm text-[#B91C1C]">
            Could not load hourly data ({error.message}). If the backend was started before this chart existed, restart it.
          </p>
        )}
        {!loading && !error && points.length === 0 && <p className="p-4 text-sm text-[#6B7A99]">No hourly data for this day.</p>}
        {points.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 34, right: 16, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id={`utci-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  {stops.map((s, i) => (
                    <stop key={i} offset={s.offset} stopColor={s.color} />
                  ))}
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              {peak && (
                <ReferenceArea
                  x1={peak.start}
                  x2={Math.min(23, peak.end - 1)}
                  fill="#FDECEC"
                  fillOpacity={0.8}
                  stroke="none"
                  label={{
                    value: `${isWbgt ? 'Rest only' : 'Peak heat hours'} · ${hourLabel(peak.start)} – ${hourLabel(peak.end)}`,
                    position: 'top',
                    fill: '#B91C1C',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
              )}
              <XAxis
                dataKey="hour"
                type="number"
                domain={[0, 23]}
                ticks={[0, 4, 8, 12, 16, 20]}
                tickFormatter={hourLabel}
                tick={{ fill: '#6B7A99', fontSize: 12 }}
                axisLine={{ stroke: '#E4EAF3' }}
                tickLine={false}
              />
              {isWbgt && (
                <ReferenceLine
                  y={WBGT_REST_ONLY_C}
                  stroke="#DC2626"
                  strokeDasharray="5 4"
                  label={{ value: '33 °C rest only', position: 'insideTopRight', fill: '#DC2626', fontSize: 12 }}
                />
              )}
              <YAxis
                domain={[yMin, yMax]}
                ticks={Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, i) => yMin + i * 10)}
                tick={{ fill: '#6B7A99', fontSize: 12 }}
                axisLine={{ stroke: '#E4EAF3' }}
                tickLine={false}
                width={56}
                label={{
                  value: isWbgt ? 'WBGT (°C)' : 'In the sun, UTCI (°C)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#3D4B6B',
                  fontSize: 12,
                  dy: 80,
                }}
              />
              <Tooltip
                formatter={(v) => [`${Number(v).toFixed(1)} °C`, isWbgt ? 'WBGT' : 'UTCI']}
                labelFormatter={(h) => hourLabel(Number(h))}
              />
              <Line
                type="monotone"
                dataKey="utci"
                stroke={isWbgt ? '#1468D4' : stops.length ? `url(#utci-${gid})` : '#22A559'}
                strokeWidth={2.5}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; payload?: { utci: number; hour: number } }) =>
                  props.payload && props.payload.hour % 2 === 0 ? (
                    <circle
                      key={props.payload.hour}
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill={
                        isWbgt ? (props.payload.utci >= WBGT_REST_ONLY_C ? '#EF4444' : '#1468D4') : utciColor(props.payload.utci)
                      }
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <g key={`n-${props.payload?.hour}`} />
                  )
                }
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[#6B7A99] [@media(max-height:860px)]:xl:hidden">
        {data?.source === 'history' ? 'Hourly archive (reanalysis)' : 'Open-Meteo hourly forecast'} for the whole city.{' '}
        {isWbgt
          ? 'WBGT (Liljegren). Shaded: 33 °C or more, the "rest only" level.'
          : 'UTCI: how hot it feels in the sun, coloured by the published UTCI scale. Shaded: 38 °C or more.'}
      </p>
    </section>
  )
}
