/**
 * Heat Action Plan levels. The level itself is decided server-side from AMC's own published
 * thresholds (backend/app/services/hap.py, AMC Heat Action Plan 2019 "Color Signals for Heat
 * Alert"); this file only names and colours it. AMC calls the lowest level "White - No Alert";
 * this app's code value for it is "Green".
 * Mirrors backend/app/services/hap.py::LEVEL_ORDER; backend/tests/
 * test_frontend_parity.py fails if the two ever disagree.
 *
 * The four colours are deliberately the SAME hues as the risk bands in
 * lib/bands.ts (Green=Low ... Red=Extreme), so a map coloured by alert level
 * and a chip coloured by risk band never contradict each other.
 */
import { BAND_COLOR } from './bands'

export const HAP_LEVELS = ['Green', 'Yellow', 'Orange', 'Red'] as const
export type HapLevel = (typeof HAP_LEVELS)[number]

export const HAP_COLOR: Record<HapLevel, string> = {
  Green: BAND_COLOR.Low,
  Yellow: BAND_COLOR.Moderate,
  Orange: BAND_COLOR.High,
  Red: BAND_COLOR.Extreme,
}

export const HAP_CLASSES: Record<HapLevel, string> = {
  Green: 'bg-green-600 text-white',
  Yellow: 'bg-amber-500 text-white',
  Orange: 'bg-orange-600 text-white',
  Red: 'bg-red-700 text-white',
}

/** AMC's own names for each level (AMC Heat Action Plan 2019, section IV.A, p.3). */
export const AMC_LEVEL_NAME: Record<HapLevel, string> = {
  Green: 'White – No Alert',
  Yellow: 'Yellow – Hot Day Advisory',
  Orange: 'Orange – Heat Alert Day',
  Red: 'Red – Extreme Heat Alert Day',
}

/**
 * Outdoor-work guidance tied to a cited rule, replacing an unverifiable "safe minutes per hour"
 * table. Source: NDMA gig/outdoor-worker heat advisory (Aug 2025), which applies during Orange
 * and Red heat alerts - the same basis backend/rules/hap_rules.toml cites for its
 * midday_work_stoppage action.
 */
export function outdoorWorkAdvice(level: HapLevel | null | undefined): { text: string; detail: string } {
  if (level === 'Orange' || level === 'Red') {
    return {
      text: 'No mandatory outdoor work 11:00–16:00',
      detail: 'NDMA outdoor-worker heat advisory (Aug 2025), applies at Orange and Red alerts: shorter shifts, a 15-minute cooling break every 90 minutes, drinking water provided.',
    }
  }
  if (level === 'Yellow') {
    return { text: 'No work-hour restriction in the plan', detail: 'Yellow is a Hot Day Advisory: hydration and awareness messaging, no mandated work stoppage.' }
  }
  if (level === 'Green') {
    return { text: 'No alert', detail: 'Below AMC\'s 41.1 °C Yellow threshold.' }
  }
  return { text: '—', detail: 'Alert level not available for this date.' }
}

export function isHapLevel(value: string): value is HapLevel {
  return (HAP_LEVELS as readonly string[]).includes(value)
}

export function hapRank(level: HapLevel): number {
  return HAP_LEVELS.indexOf(level)
}

export const DEPARTMENT_LABEL: Record<string, string> = {
  public: 'Public messaging',
  municipal: 'Municipal corporation',
  health: 'Health department',
  labour: 'Labour department',
  power_utility: 'Power utility',
}

/** AMC's alert thresholds on the day's maximum temperature (°C), same source as the level itself. */
export const AMC_THRESHOLD_C: Record<Exclude<HapLevel, 'Green'>, number> = { Yellow: 41.1, Orange: 43.1, Red: 45 }
