/**
 * Shared presentation helpers for the dashboard (colours, dates, hours). No data lives here.
 */

export const NAVY = '#13265C'
export const BLUE = '#1468D4'

/** HeatLens risk band -> pill colours (the model's own bands; see lib/bands.ts). */
export const BAND_PILL: Record<string, { bg: string; fg: string }> = {
  Extreme: { bg: '#DC2626', fg: '#FFFFFF' },
  High: { bg: '#F26B6B', fg: '#FFFFFF' },
  Moderate: { bg: '#FBD34D', fg: '#13265C' },
  Low: { bg: '#86CF8E', fg: '#FFFFFF' },
}

export const BAND_TINT: Record<string, string> = {
  Extreme: '#FDE8E8',
  High: '#FDECEC',
  Moderate: '#FEF6DC',
  Low: '#EAF7EC',
}

export const BAND_ACCENT: Record<string, string> = {
  Extreme: '#DC2626',
  High: '#E02424',
  Moderate: '#D97706',
  Low: '#16A34A',
}

/** Published UTCI heat-stress scale (Broede et al.; htsi.plan_a UTCI_HEAT_BANDS). */
export const UTCI_STEPS: { min: number; color: string; label: string }[] = [
  { min: 38, color: '#EF4444', label: 'Very strong or extreme' },
  { min: 32, color: '#F97316', label: 'Strong' },
  { min: 26, color: '#FBBF24', label: 'Moderate' },
  { min: -Infinity, color: '#22A559', label: 'No heat stress' },
]

/**
 * A UTCI value's category on the published UTCI assessment scale (Broede et al.), worded so it is
 * never mistaken for the HeatLens heat-stress band shown beside it.
 */
export function utciCategory(v: number | null | undefined): string {
  if (v == null) return ''
  if (v >= 46) return 'UTCI scale: extreme'
  if (v >= 38) return 'UTCI scale: very strong'
  if (v >= 32) return 'UTCI scale: strong'
  if (v >= 26) return 'UTCI scale: moderate'
  return 'UTCI scale: no heat stress'
}

export function utciColor(v: number): string {
  return UTCI_STEPS.find((s) => v >= s.min)!.color
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

function asDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function weekdayShort(iso: string): string {
  return asDate(iso).toLocaleDateString('en-GB', { weekday: 'short' })
}

export function dayMonth(iso: string): string {
  return asDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** 0 -> "12 AM", 13 -> "1 PM", 24 -> "12 AM". */
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24
  const suffix = hh < 12 ? 'AM' : 'PM'
  const twelve = hh % 12 === 0 ? 12 : hh % 12
  return `${twelve} ${suffix}`
}

/** WBGT >= 33 °C: the "rest only" level cited in htsi/plan_a_standard_metrics.py (WBGT_CRITICAL_C). */
export const WBGT_REST_ONLY_C = 33

/** The continuous run of hours with WBGT >= 33 °C around the day's highest WBGT, or null. */
export function restOnlyRun(points: { hour: number; v: number }[]): { start: number; end: number } | null {
  if (!points.length) return null
  const set = new Set(points.filter((p) => p.v >= WBGT_REST_ONLY_C).map((p) => p.hour))
  const top = points.reduce((a, b) => (b.v > a.v ? b : a)).hour
  if (!set.has(top)) return null
  let lo = top
  let hi = top
  while (set.has(lo - 1)) lo--
  while (set.has(hi + 1)) hi++
  return { start: lo, end: hi + 1 }
}

/** Daytime cloud cover (%) in one word - the same cut-offs WeatherIcon draws. */
export function skyWord(cloudPct: number | null | undefined): string | null {
  if (cloudPct == null) return null
  if (cloudPct < 25) return 'Sunny'
  if (cloudPct < 70) return 'Partly cloudy'
  return 'Cloudy'
}

/** HeatLens 0-100 score -> fill colour: a continuous ramp through the band colours (lib/bands.ts),
 * so wards in the same band still show their real differences. */
const SCORE_STOPS: [number, [number, number, number]][] = [
  [0, [59, 159, 79]],
  [30, [232, 179, 44]],
  [50, [224, 105, 46]],
  [70, [198, 40, 40]],
  [100, [127, 29, 29]],
]

export function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score))
  let k = 0
  while (k < SCORE_STOPS.length - 2 && s > SCORE_STOPS[k + 1][0]) k++
  const [a, ca] = SCORE_STOPS[k]
  const [b, cb] = SCORE_STOPS[k + 1]
  const t = (s - a) / (b - a)
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** Legend rows for the score map: the model's bands (lib/bands.ts thresholds). */
export const SCORE_LEGEND: { label: string; color: string }[] = [
  { label: 'Extreme · 70+', color: scoreColor(80) },
  { label: 'High · 50–69', color: scoreColor(60) },
  { label: 'Moderate · 30–49', color: scoreColor(40) },
  { label: 'Low · under 30', color: scoreColor(15) },
]
