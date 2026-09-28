/**
 * Stage 5 — the Mortality Risk Index (PS requirement R2), shown honestly.
 *
 * What is displayed is a published relative risk with its confidence interval,
 * not a forecast of deaths (schemas/health.py has no death-count field, and
 * backend/tests/test_services_health.py fails if one is added). Every reading
 * carries the "not validated locally" chip: the coefficients validate the
 * temperature-mortality link, not HeatLens's own indices.
 */
import type { HealthRisk } from '../../api/hooks'
import EvidenceBadge from '../layout/EvidenceBadge'
import type { EvidenceLabel } from '../../lib/evidence'

const TIER: Record<HealthRisk['exposure_tier'], { label: string; chip: string; explain: string }> = {
  heatwave: {
    label: 'Heatwave',
    chip: 'bg-red-100 text-red-800',
    explain:
      'Two or more consecutive days with daily mean temperature above the local 97th percentile — the definition the published Ahmedabad estimate is for.',
  },
  single_day_above_p97: {
    label: 'First day above threshold',
    chip: 'bg-amber-100 text-amber-800',
    explain:
      'One day above the local 97th percentile. A second consecutive day would meet the published heatwave definition.',
  },
  below_threshold: {
    label: 'Below heatwave threshold',
    chip: 'bg-[#E9EEF5] text-[#3D4B6B]',
    explain:
      'The source study quantifies no elevated mortality here. That is its reference group, not a claim that heat is harmless.',
  },
}

const PMC_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11790314/'

interface Props {
  health: HealthRisk
  /** Compact: for the map's side panel. Omits the cross-checks. */
  compact?: boolean
}

export default function HealthCard({ health, compact = false }: Props) {
  const tier = TIER[health.exposure_tier]
  const elevated = health.exposure_tier === 'heatwave'
  const uplift = Math.round((health.relative_risk - 1) * 100)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tier.chip}`}>{tier.label}</span>
        <EvidenceBadge evidence={health.evidence as EvidenceLabel} />
        <span
          className="rounded-full bg-[#F1F4F9] px-2 py-0.5 text-xs text-[#51607F]"
          title="The published coefficients were not fitted to Ahmedabad outcome data by HeatLens."
        >
          Not validated locally
        </span>
      </div>

      <div className="mt-3 flex items-end gap-4">
        <div>
          <p className="text-xs text-[#6B7A99]">Relative risk</p>
          <p className="text-3xl font-bold tabular-nums leading-none">{health.relative_risk.toFixed(2)}×</p>
        </div>
        <div className="pb-0.5 text-xs text-[#6B7A99]">
          {elevated ? (
            <>
              95% CI {health.rr_ci_low.toFixed(2)}–{health.rr_ci_high.toFixed(2)}
              <br />
              about {uplift}% higher daily mortality than non-heatwave days
            </>
          ) : (
            <>vs non-heatwave days</>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-[#6B7A99]">
          <span>Mortality Risk Index</span>
          <span className="font-medium tabular-nums text-[#3D4B6B]">
            {health.mri_0_100.toFixed(0)} / 100
          </span>
        </div>
        <div
          role="meter"
          aria-label="Mortality Risk Index"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={health.mri_0_100}
          className="mt-1 h-2 overflow-hidden rounded-full bg-[#E9EEF5]"
        >
          <div
            className="h-full rounded-full bg-red-600"
            style={{ width: `${Math.min(100, Math.max(0, health.mri_0_100))}%` }}
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-[#6B7A99]">
        Daily mean {health.daily_mean_temp_c.toFixed(1)} °C vs local heatwave threshold{' '}
        {health.threshold_p97_c.toFixed(1)} °C
        {health.intensity_pct != null && <> (+{health.intensity_pct.toFixed(1)}%)</>}. {tier.explain}
      </p>

      {!compact && health.cross_checks.length > 0 && (
        <div className="mt-3 rounded-md bg-[#F8FAFD] p-3 text-xs">
          <p className="font-medium text-[#51607F]">
            Independent cross-check (informational only)
          </p>
          <ul className="mt-1 space-y-0.5 text-[#6B7A99]">
            {health.cross_checks.map((c) => (
              <li key={c.condition}>
                <span className={c.triggered ? 'font-semibold text-red-700' : ''}>
                  {c.triggered ? '● ' : '○ '}
                  {c.condition}: +{c.effect_pct}%
                </span>{' '}
                <span className="text-[#8A97B1]">{c.triggered ? 'met' : 'not met'}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[#8A97B1]">Hyderabad, descriptive study; not folded into the relative risk.</p>
        </div>
      )}

      <p className="mt-3 text-xs text-[#8A97B1]">
        A published association (
        <a href={PMC_URL} target="_blank" rel="noreferrer" className="underline hover:text-[#51607F]">
          {health.source}
        </a>
        ), not a forecast of deaths. HeatLens does not predict admissions or absolute counts: no outcome data
        exists to calibrate them.
      </p>
    </div>
  )
}
