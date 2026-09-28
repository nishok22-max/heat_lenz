/**
 * Mirrors backend/app/core/labels.py::EvidenceLabel. IMPLEMENTATION_PLAN.md §7.2:
 * every value that isn't directly measured carries one of these, and the UI
 * renders it as a coloured chip via components/layout/EvidenceBadge.tsx rather
 * than leaving the distinction to a tooltip nobody reads.
 */
export type EvidenceLabel =
  | 'MEASURED_POINT'
  | 'MEASURED_CENSUS'
  | 'MEASURED_FORECAST'
  | 'MODELLED_PUBLISHED'
  | 'MODELLED_UNCALIBRATED'
  | 'MODELLED_CALIBRATED'
  | 'MEASURED_SATELLITE'
  | 'ILLUSTRATIVE'

export const EVIDENCE_META: Record<EvidenceLabel, { label: string; className: string }> = {
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
  MODELLED_PUBLISHED: {
    label: 'Published source',
    className: 'bg-sky-100 text-sky-800',
  },
  MODELLED_UNCALIBRATED: {
    label: 'Uncalibrated model',
    className: 'bg-amber-100 text-amber-800',
  },
  MODELLED_CALIBRATED: {
    label: 'Calibrated (May 2010 deaths)',
    className: 'bg-teal-100 text-teal-800',
  },
  MEASURED_SATELLITE: {
    label: 'Measured (satellite)',
    className: 'bg-emerald-100 text-emerald-800',
  },
  ILLUSTRATIVE: {
    label: 'Illustrative',
    className: 'bg-[#E9EEF5] text-[#3D4B6B]',
  },
}
