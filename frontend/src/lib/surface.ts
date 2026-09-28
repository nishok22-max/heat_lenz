/**
 * Display bins for the measured MODIS surface-temperature anomaly (ward minus city mean), shared
 * by the map and the ward panel so a colour means the same thing in both. The bin edges are a
 * legend choice, not data; the value shown next to each colour is the measured one.
 */
export const SURFACE_BINS: { min: number; color: string; label: string }[] = [
  { min: 1.5, color: '#EF4444', label: '> +1.5 °C' },
  { min: 0.5, color: '#F97316', label: '+0.5 to +1.5 °C' },
  { min: -0.5, color: '#FBBF24', label: '−0.5 to +0.5 °C' },
  { min: -1.5, color: '#9BD58E', label: '−1.5 to −0.5 °C' },
  { min: -Infinity, color: '#22A559', label: '< −1.5 °C' },
]

/** Values are shown to one decimal, so classify on that same rounded value - otherwise +0.49
 * would print as "+0.5 °C" while sitting in the "about average" bin. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export function surfaceColor(anomaly: number | null | undefined): string | null {
  if (anomaly == null) return null
  const a = round1(anomaly)
  return SURFACE_BINS.find((b) => a >= b.min)!.color
}

/** Dark text on the two light bins (yellow, light green), white on the rest. */
export function surfaceTextColor(anomaly: number | null | undefined): string {
  if (anomaly == null) return '#ffffff'
  const a = round1(anomaly)
  return a > -1.5 && a < 0.5 ? '#13265C' : '#ffffff'
}

export function signed(v: number, digits = 1): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`
}

/** 1-based rank of ``value`` among ``values``, highest first. */
export function rankDesc(value: number, values: number[]): number {
  return 1 + values.filter((v) => v > value).length
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/**
 * ZoneRisk.weather_basis in one short line. The backend sentence names the forecast grid cell and
 * how many wards share it; the full sentence stays available as a tooltip.
 */
export function weatherBasisShort(basis: string | null | undefined): string {
  if (!basis) return ''
  const shared = basis.match(/shared with (\d+) other wards?/)
  if (basis.startsWith('Open-Meteo forecast for this ward')) {
    return shared
      ? `Open-Meteo forecast for this part of the city, shared with ${shared[1]} other wards in the same forecast grid cell.`
      : 'Open-Meteo forecast for this part of the city.'
  }
  if (basis.startsWith('City-level weather record')) return 'City-level weather record: every ward shares these values on past dates.'
  return basis
}
