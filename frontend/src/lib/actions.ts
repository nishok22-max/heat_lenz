import type { AdvisoryResponse, HapAction } from '../api/hooks'
import { isCityAction } from './advice'

/**
 * Where an action comes from, shown next to it:
 * - plan: the AMC Heat Action Plan's own action for today's official alert level;
 * - suggestion: a city action HeatLens adds because its heat-stress score is raised
 *   (backend/rules/advisory_rules.toml), beyond what the plan asks at this level;
 * - advice: personal advice (drinking water, the heatwave health note).
 */
export type ActionSource = 'plan' | 'suggestion' | 'advice'

export interface ActionRow {
  key: string
  text: string
  kind: string
  to: string
  source: ActionSource
}

export const SOURCE_LABEL: Record<ActionSource, string> = {
  plan: 'AMC plan',
  suggestion: 'HeatLens suggestion',
  advice: 'Advice',
}

/**
 * The official Heat Action Plan actions for the day's AMC level come first, then the advisory
 * engine's recommendations - de-duplicated by kind, so the list stays short. Each row opens the
 * full advisory with its cited basis.
 */
export function buildActions(
  hapActions: HapAction[],
  advisories: (AdvisoryResponse | undefined)[],
  advisoryLink: string,
  limit = 5,
  /** Only Heat Action Plan actions for these departments (public, municipal, health, labour,
   *  power_utility); all departments when omitted. */
  departments?: string[],
): ActionRow[] {
  const rows: ActionRow[] = []
  const seen = new Set<string>()
  const add = (kind: string, text: string, source: ActionSource) => {
    if (seen.has(kind) || rows.length >= limit) return
    seen.add(kind)
    rows.push({ key: `${kind}-${rows.length}`, kind, text, to: advisoryLink, source })
  }
  hapActions.filter((a) => !departments || departments.includes(a.department)).forEach((a) => add(a.kind, a.title, 'plan'))
  advisories.forEach((adv) =>
    adv?.recommendations.forEach((r) => add(r.kind, r.title, isCityAction(r.kind) ? 'suggestion' : 'advice')),
  )
  return rows
}
