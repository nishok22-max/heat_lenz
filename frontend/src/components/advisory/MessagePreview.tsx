/**
 * The SMS / WhatsApp text an area's residents would get (POST /dispatch/preview). A dry run: the
 * backend's DispatchResponse.status can only ever be "SIMULATED", so nothing here can be sent.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useDispatchPreview, type Persona } from '../../api/hooks'
import { dayMonth } from '../../lib/dashboard'

const NAVY = '#13265C'
const LANGS = [
  { id: 'gu', label: 'ગુજરાતી' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'en', label: 'English' },
] as const
type Lang = (typeof LANGS)[number]['id']

function Toggle<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] p-1">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${value === it.id ? 'bg-white shadow-sm' : 'text-[#6B7A99]'}`}
          style={value === it.id ? { color: NAVY } : undefined}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

interface Props {
  zoneId: string
  zoneName: string
  date: string
  persona?: Persona
  onClose: () => void
  /** Optional extra button on the left of the footer (e.g. "Area details"). */
  extra?: ReactNode
}

export default function MessagePreview({ zoneId, zoneName, date, persona = 'general', onClose, extra }: Props) {
  const dispatch = useDispatchPreview()
  const { mutate } = dispatch
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms')
  const [lang, setLang] = useState<Lang>('gu')

  useEffect(() => {
    mutate({ zone_id: zoneId, channel, language: lang, persona, date })
  }, [mutate, zoneId, channel, lang, persona, date])

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#13265C]/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-semibold" style={{ color: NAVY }}>
              Message for {zoneName}
            </h3>
            <p className="text-[13px] text-[#6B7A99]">
              What residents would receive on {dayMonth(date)}. Practice mode: nothing is sent.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-[#6B7A99] hover:bg-[#F4F8FC]" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Toggle
            items={[
              { id: 'sms', label: 'SMS' },
              { id: 'whatsapp', label: 'WhatsApp' },
            ]}
            value={channel}
            onChange={setChannel}
          />
          <Toggle items={LANGS} value={lang} onChange={setLang} />
        </div>

        <div className="rounded-2xl bg-[#EEF4FB] p-4">
          {dispatch.isPending ? (
            <p className="py-4 text-center text-[14px] text-[#6B7A99]">Preparing the message…</p>
          ) : dispatch.data ? (
            <div
              className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-[15px] leading-relaxed shadow-sm"
              style={{ color: NAVY }}
            >
              {dispatch.data.message_preview}
            </div>
          ) : (
            <p className="text-[14px] text-[#6B7A99]">Could not prepare the message for this date.</p>
          )}
        </div>
        {dispatch.data && (
          <p className="text-[12px] leading-snug text-[#8A97B1]">
            {dispatch.data.disclaimer} Who would receive it: {dispatch.data.recipients_basis}
          </p>
        )}
        <div className="flex justify-between gap-2">
          <span>{extra}</span>
          <button
            onClick={onClose}
            className="rounded-xl bg-[#13265C] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#0E1D49]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
