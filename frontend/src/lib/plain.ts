/**
 * Plain-language wording for non-specialists (the Municipal Commissioner, ward officers,
 * residents). Every phrase here is derived from a real value the API already returns - these
 * helpers only choose words for it; they never create a new number.
 *
 * Sources the wording leans on:
 * - AMC alert levels and their meaning: AMC Heat Action Plan 2019, "Color Signals for Heat
 *   Alert" (backend/rules/hap_rules.toml).
 * - What each level asks departments to do: the actions in hap_rules.toml (NDMA outdoor-worker
 *   advisory for the 11:00-16:00 rule; AMC HAP for cooling centres).
 * - Mortality wording: de Bont et al. 2024, Ahmedabad relative risk.
 */
import type { HapLevel } from './hap'
import { round1 } from './surface'

export interface Plain {
  word: string
  detail: string
}

/** Ground (roof and road) temperature compared with the city average. Same bin edges as the map. */
export function groundHeat(anomaly: number | null | undefined): Plain {
  if (anomaly == null) return { word: 'No satellite data', detail: '' }
  anomaly = round1(anomaly)
  const a = Math.abs(anomaly).toFixed(1)
  if (anomaly >= 1.5) return { word: 'Much hotter than most of the city', detail: `${a} °C above the city average` }
  if (anomaly >= 0.5) return { word: 'Hotter than most of the city', detail: `${a} °C above the city average` }
  if (anomaly > -0.5) return { word: 'About the city average', detail: `within 0.5 °C of the city average` }
  if (anomaly > -1.5) return { word: 'Cooler than most of the city', detail: `${a} °C below the city average` }
  return { word: 'Much cooler than most of the city', detail: `${a} °C below the city average` }
}

/** What an AMC level means, and what the plan asks for - in one line each. */
export const LEVEL_PLAIN: Record<HapLevel, { headline: string; meaning: string; actions: string[] }> = {
  Green: {
    headline: 'No heat alert',
    meaning: 'Maximum temperature 41 °C or below.',
    actions: ['Normal precautions: drink water, avoid long hours in direct sun.'],
  },
  Yellow: {
    headline: 'Hot day advisory',
    meaning: 'Maximum temperature 41.1–43 °C.',
    actions: [
      'Send heat-awareness and drink-water messages to the public.',
      'Health centres check ORS stock and heat-illness readiness.',
    ],
  },
  Orange: {
    headline: 'Heat alert',
    meaning: 'Maximum temperature 43.1–44.9 °C.',
    actions: [
      'Open cooling centres.',
      'No mandatory outdoor work 11 am – 4 pm; shorter shifts and water for outdoor workers.',
      'Hospitals prepare for more heat-illness patients.',
    ],
  },
  Red: {
    headline: 'Extreme heat alert',
    meaning: 'Maximum temperature 45 °C or above.',
    actions: [
      'Open cooling centres.',
      'No mandatory outdoor work 11 am – 4 pm; outdoor work only where unavoidable.',
      'Hospitals prepare for more heat-illness patients; emergency services on readiness.',
      'Power utility asked to protect supply to hospitals and cooling centres.',
    ],
  },
}

/** Published Ahmedabad heatwave mortality risk, in words. */
export function deathRisk(rr: number | null | undefined, tier: string | null | undefined): Plain {
  if (rr == null) return { word: '—', detail: '' }
  if (tier === 'heatwave') {
    const pct = Math.round((rr - 1) * 100)
    return {
      word: `About ${pct}% more deaths than a normal day`,
      detail:
        'On heatwave days like this, Ahmedabad saw this rise in deaths from all causes (published study, de Bont et al. 2024). Not a count of expected deaths.',
    }
  }
  if (tier === 'single_day_above_p97') {
    return {
      word: 'Normal, but one more hot day makes it a heatwave',
      detail: 'Today is above the heatwave temperature; a second day in a row would raise the published death risk.',
    }
  }
  return { word: 'Normal (no heatwave)', detail: 'Not a heatwave day by the published Ahmedabad definition.' }
}

/** The HeatLens 0-100 score in words (the model's own bands, uncalibrated). */
export function stressWord(band: string | null | undefined): string {
  switch (band) {
    case 'Extreme':
      return 'Extreme heat stress'
    case 'High':
      return 'High heat stress'
    case 'Moderate':
      return 'Moderate heat stress'
    case 'Low':
      return 'Low heat stress'
    default:
      return '—'
  }
}

export function lakh(n: number): string {
  return n >= 100_000 ? `${(n / 100_000).toFixed(1)} lakh` : n.toLocaleString('en-IN')
}

/** The model's score components (htsi/plan_d component names) in everyday words. */
export const DRIVER_PLAIN: Record<string, string> = {
  'WBGT (Humidity)': 'Humid, sticky heat',
  'UTCI (Solar/Wind)': 'Strong sun and little wind',
  'Tmax Surge (X)': 'Much hotter than usual for the season',
  'Heat Debt (Plan C)': 'Hot nights that give no relief',
}

export function driverPlain(d: string): string {
  return DRIVER_PLAIN[d] ?? d
}

/** The score's calibrated meaning in deaths (services/score_calibration.py), in words. */
export interface ScoreDeaths {
  in_calibrated_range: boolean
  death_ratio?: number | null
  ci_low?: number | null
  ci_high?: number | null
  calibrated_range: [number, number] | number[]
}

export function scoreDeaths(sm: ScoreDeaths | null | undefined, score?: number): Plain {
  if (!sm) return { word: '—', detail: '' }
  const [lo, hi] = sm.calibrated_range
  if (!sm.in_calibrated_range || sm.death_ratio == null) {
    return {
      word:
        score != null && score > hi
          ? 'Hotter than any day in May 2010: no death estimate'
          : 'Milder than the 2010 heatwave days: no death estimate',
      detail: `The score's meaning in deaths is known only for scores seen in the May 2010 heatwave (${Math.round(lo)}–${Math.round(hi)}); outside that range HeatLens gives no estimate rather than a guess.`,
    }
  }
  const pct = (r: number) => Math.round((r - 1) * 100)
  const p = pct(sm.death_ratio)
  const range = sm.ci_low != null && sm.ci_high != null ? ` (likely ${pct(sm.ci_low)}% to ${pct(sm.ci_high)}%)` : ''
  return {
    word: p <= 0 ? 'About a normal number of deaths' : `About ${p}% more deaths than a normal day`,
    detail: `In the May 2010 Ahmedabad heatwave, days with this score had ${p <= 0 ? 'about normal deaths' : `about ${p}% more deaths`}${range}. Fitted on 31 days of real deaths; one event only.`,
  }
}
