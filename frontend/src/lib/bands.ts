/**
 * Risk-band -> colour, and score -> band. Single source of truth —
 * IMPLEMENTATION_PLAN.md §6.3 calls out duplicating this mapping as "the most
 * likely source of a visual inconsistency a judge will spot."
 *
 * Thresholds mirror htsi/plan_d_ensemble.py::CalibratedHeatLensEnsemble.predict_row
 * exactly (>=70 Extreme, >=50 High, >=30 Moderate, else Low). If that function's
 * thresholds ever change, this file must change with it — see
 * backend/tests/test_services_spatial.py for the Python-side values this mirrors.
 */

export type RiskBand = 'Low' | 'Moderate' | 'High' | 'Extreme'

export const BAND_THRESHOLDS: { band: RiskBand; min: number }[] = [
  { band: 'Extreme', min: 70 },
  { band: 'High', min: 50 },
  { band: 'Moderate', min: 30 },
  { band: 'Low', min: 0 },
]

export function bandForScore(score: number): RiskBand {
  for (const { band, min } of BAND_THRESHOLDS) {
    if (score >= min) return band
  }
  return 'Low'
}

/** Fill colour for the band, used by the map choropleth, legend and chips. */
export const BAND_COLOR: Record<RiskBand, string> = {
  Low: '#3b9f4f',
  Moderate: '#e8b32c',
  High: '#e0692e',
  Extreme: '#c62828',
}

/** Tailwind-friendly text/background pairs for chips and badges. */
export const BAND_CLASSES: Record<RiskBand, string> = {
  Low: 'bg-green-100 text-green-800',
  Moderate: 'bg-amber-100 text-amber-800',
  High: 'bg-orange-100 text-orange-800',
  Extreme: 'bg-red-100 text-red-800',
}

export function isRiskBand(value: string): value is RiskBand {
  return value === 'Low' || value === 'Moderate' || value === 'High' || value === 'Extreme'
}
