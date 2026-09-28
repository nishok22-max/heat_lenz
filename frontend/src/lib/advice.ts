/**
 * Who each piece of advice is for, and the resident advice for an AMC alert level. One place, so
 * the dashboard, the forecast, the advice page and the residents' page never disagree.
 *
 * Two different signals exist and are always named apart:
 * - the official AMC alert (AMC Heat Action Plan 2019, on the day's highest temperature) decides
 *   what residents are told to do and what the plan asks departments to do;
 * - the HeatLens heat-stress score also counts humidity, sun and hot nights. Where it asks for more
 *   than the plan (a cooling centre on a humid day with no alert), that is shown to officials as a
 *   HeatLens suggestion, never to residents as an instruction.
 */
import { Droplets, HardHat, Home, Sun, Users, type LucideIcon } from 'lucide-react'
import type { Recommendation } from '../api/hooks'
import type { HapLevel } from './hap'
import { outdoorWorkAdvice } from './hap'
import { STRINGS, type Lang } from './i18n'

/** Advisory-rule kinds (backend/rules/advisory_rules.toml) that are jobs for the city, not residents. */
export const CITY_KINDS = new Set(['cooling_centre', 'vulnerable_check', 'regional_alert'])

export function isCityAction(kind: string): boolean {
  return CITY_KINDS.has(kind)
}

/** Advice a resident can act on themselves. */
export function forResidents(recs: Recommendation[]): Recommendation[] {
  return recs.filter((r) => !isCityAction(r.kind))
}

export interface ResidentTip {
  key: string
  icon: LucideIcon
  text: string
}

/**
 * What residents should do, stronger as the official AMC level rises. The phrases are the fixed,
 * translated set in lib/i18n.ts (the same ones the SMS preview uses); the outdoor-work line is the
 * NDMA rule for Orange and Red alerts (lib/hap.ts), English only.
 */
export function residentTips(level: HapLevel | null, lang: Lang = 'en', hasPeakHours = true): ResidentTip[] {
  const t = STRINGS[lang]
  const tips: ResidentTip[] = [{ key: 'water', icon: Droplets, text: t.drink_water }]
  if (hasPeakHours) tips.push({ key: 'sun', icon: Sun, text: t.avoid_sun_peak })
  if (level && level !== 'Green') {
    tips.push({ key: 'indoors', icon: Home, text: t.stay_indoors }, { key: 'elderly', icon: Users, text: t.check_elderly })
  }
  if (lang === 'en' && (level === 'Orange' || level === 'Red')) {
    tips.push({ key: 'work', icon: HardHat, text: outdoorWorkAdvice(level).text })
  }
  return tips
}
