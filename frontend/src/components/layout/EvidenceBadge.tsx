/**
 * IMPLEMENTATION_PLAN.md §6.3: "placed next to every number that is not
 * directly measured. This one component is what separates HeatLens from a
 * dashboard that quietly invents precision."
 */
import { EVIDENCE_META, type EvidenceLabel } from '../../lib/evidence'

export default function EvidenceBadge({ evidence }: { evidence: EvidenceLabel }) {
  const meta = EVIDENCE_META[evidence]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
      title={evidence}
    >
      {meta.label}
    </span>
  )
}
