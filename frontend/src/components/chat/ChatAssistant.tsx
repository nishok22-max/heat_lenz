/**
 * The HeatLens assistant: a launcher button and a chat panel. Answers stream sentence by sentence;
 * each sentence has already passed the server's checks (backend/app/chat/output_guard.py) before it
 * arrives. A "retract" event means the server withdrew what it had shown and is replacing it.
 *
 * The officials' console uses audience "authority", the residents' page "public"; the server words
 * answers for each. Neither is authenticated: the audience changes tone, not what data is visible.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, MessageCircle, Phone, RotateCcw, X } from 'lucide-react'
import { SunLogo } from '../layout/Sidebar'
import { EMERGENCY_NUMBER } from '../../lib/heatIllness'
import {
  clearChat,
  deviceProfile,
  sendChat,
  type Audience,
  type ChatEvent,
  type ChatMemory,
} from '../../lib/chat'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  sources?: string[]
  firstMs?: number | null
  cached?: boolean
  blocked?: boolean
}

const STARTERS: Record<Audience, string[]> = {
  public: [
    'Is it safe to go outside today?',
    'I work outdoors in Maninagar. When should I rest?',
    'What are the signs of heat stroke?',
    'Kal garmi kitni hogi?',
  ],
  authority: [
    'What does the AMC plan ask departments to do today?',
    'Which days this week reach an AMC alert?',
    'Why does HeatLens show High when there is no AMC alert?',
    'How reliable is the 5-day forecast?',
  ],
}

const ROLE_LABEL: Record<string, string> = {
  resident: 'Resident',
  outdoor_worker: 'Outdoor worker',
  official: 'Official',
  health_worker: 'Health worker',
  employer: 'Employer',
}
const LANG_LABEL: Record<string, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' }
const GROUP_LABEL: Record<string, string> = {
  elderly: 'Older person',
  child: 'Child',
  pregnant: 'Pregnant',
  chronic_illness: 'Long-term illness',
}

function memoryChips(m: ChatMemory): string[] {
  const out: string[] = []
  if (m.ward_name) out.push(m.ward_name)
  if (m.role) out.push(ROLE_LABEL[m.role] ?? m.role)
  if (m.group && m.group !== 'none') out.push(GROUP_LABEL[m.group] ?? m.group)
  if (m.language) out.push(LANG_LABEL[m.language] ?? m.language)
  return out
}

export default function ChatAssistant({ audience }: { audience: Audience }) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [memory, setMemory] = useState<ChatMemory>({})
  const [keep, setKeep] = useState(() => deviceProfile.get() !== null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, status])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    if (open) window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  // Keep the device copy in step with what the server remembers, only while the box is ticked.
  useEffect(() => {
    if (keep && (memory.ward_id || memory.language)) deviceProfile.set({ ward_id: memory.ward_id, language: memory.language })
  }, [keep, memory.ward_id, memory.language])

  const patchLast = (fn: (t: Turn) => Turn) =>
    setTurns((ts) => (ts.length ? [...ts.slice(0, -1), fn(ts[ts.length - 1])] : ts))

  async function ask(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setError(null)
    setInput('')
    setBusy(true)
    setStatus('Thinking')
    setTurns((ts) => [...ts, { role: 'user', text: q }, { role: 'assistant', text: '' }])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const onEvent = (e: ChatEvent) => {
      if (e.type === 'status') setStatus(e.text)
      else if (e.type === 'delta') {
        setStatus(null)
        patchLast((t) => ({ ...t, text: t.text + e.text }))
      } else if (e.type === 'retract') {
        setStatus('Checking the answer')
        patchLast((t) => ({ ...t, text: '' }))
      } else if (e.type === 'memory') setMemory(e.memory)
      else if (e.type === 'done') {
        setMemory(e.memory)
        patchLast((t) => ({
          ...t,
          text: t.text.trim(),
          sources: e.blocked ? undefined : e.sources,
          firstMs: e.first_text_ms,
          cached: e.cached,
          blocked: Boolean(e.blocked),
        }))
      }
    }
    try {
      await sendChat(q, audience, onEvent, ctrl.signal)
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        setTurns((ts) => (ts[ts.length - 1]?.text === '' ? ts.slice(0, -1) : ts))
      }
    } finally {
      setBusy(false)
      setStatus(null)
      abortRef.current = null
    }
  }

  async function reset() {
    abortRef.current?.abort()
    await clearChat()
    setTurns([])
    setMemory({})
    setError(null)
    if (!keep) deviceProfile.set(null)
  }

  function forget() {
    deviceProfile.set(null)
    setKeep(false)
    void reset()
  }

  function onKeep(checked: boolean) {
    setKeep(checked)
    deviceProfile.set(checked ? { ward_id: memory.ward_id, language: memory.language } : null)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(input)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void ask(input)
    }
  }

  const chips = memoryChips(memory)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[1200] flex items-center gap-2 rounded-full bg-[#13265C] py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(19,38,92,0.28)] transition hover:bg-[#1B3478] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1468D4] print:hidden"
      >
        <MessageCircle className="h-5 w-5" strokeWidth={2.2} />
        Ask HeatLens
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="HeatLens assistant"
      className="fixed bottom-4 right-4 z-[1200] flex h-[min(640px,calc(100dvh-32px))] w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-[#E4EAF3] bg-white text-[#13265C] shadow-[0_18px_48px_rgba(15,30,69,0.22)] print:hidden"
    >
      <header className="flex items-center gap-3 border-b border-[#EEF2F7] px-4 py-3">
        <SunLogo className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight">HeatLens assistant</p>
          <p className="truncate text-xs text-[#6B7A99]">Answers from HeatLens data · not a doctor</p>
        </div>
        <button
          onClick={() => void reset()}
          aria-label="Clear chat"
          title="Clear chat"
          className="rounded-lg p-2 text-[#6B7A99] hover:bg-[#F4F8FC] hover:text-[#13265C]"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded-lg p-2 text-[#6B7A99] hover:bg-[#F4F8FC] hover:text-[#13265C]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {chips.length > 0 && (
        <div className="border-b border-[#EEF2F7] bg-[#F8FAFD] px-4 py-2 text-xs text-[#3D4B6B]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[#6B7A99]">Remembering:</span>
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-[#DCE6F2] bg-white px-2 py-0.5 font-medium">
                {c}
              </span>
            ))}
            <button onClick={forget} className="ml-auto font-medium text-[#1468D4] hover:underline">
              Forget
            </button>
          </div>
          {(memory.ward_id || memory.language) && (
            <label className="mt-1.5 flex items-center gap-1.5 text-[#6B7A99]">
              <input type="checkbox" checked={keep} onChange={(e) => onKeep(e.target.checked)} className="accent-[#1468D4]" />
              Keep my ward &amp; language on this device
            </label>
          )}
        </div>
      )}

      <div ref={listRef} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div>
            <p className="text-sm leading-relaxed text-[#3D4B6B]">
              Ask about today's heat, the forecast for your ward, AMC heat alerts, outdoor work or staying safe. English,
              Hindi or Gujarati.
            </p>
            <div className="mt-4 flex flex-col items-start gap-2">
              {STARTERS[audience].map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-left text-sm text-[#13265C] transition hover:border-[#1468D4] hover:bg-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#1468D4] px-3.5 py-2 text-sm leading-relaxed text-white">
                {t.text}
              </p>
            </div>
          ) : (
            <div key={i} className="max-w-[92%]">
              {(t.text || !busy || i !== turns.length - 1) && (
                <p
                  className={`whitespace-pre-wrap rounded-2xl rounded-bl-md px-3.5 py-2 text-sm leading-relaxed ${
                    t.blocked ? 'bg-[#FFF7ED] text-[#7C2D12]' : 'bg-[#F4F8FC] text-[#13265C]'
                  }`}
                >
                  {t.text}
                </p>
              )}
              {i === turns.length - 1 && busy && status && (
                <p role="status" className="mt-1.5 flex items-center gap-2 px-1 text-xs text-[#6B7A99]">
                  <span className="flex gap-0.5" aria-hidden="true">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8A97B1]"
                        style={{ animationDelay: `${d * 120}ms` }}
                      />
                    ))}
                  </span>
                  {status}…
                </p>
              )}
              {t.sources && t.sources.length > 0 && (
                <p className="mt-1 px-1 text-[11px] leading-snug text-[#8A97B1]">
                  Source: {t.sources.join(' · ')}
                  {t.firstMs != null && <> · first words {(t.firstMs / 1000).toFixed(2)} s</>}
                  {t.cached && <> · cached</>}
                </p>
              )}
            </div>
          ),
        )}
        {error && <p className="rounded-xl bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
      </div>

      <form onSubmit={onSubmit} className="border-t border-[#EEF2F7] px-3 pb-2 pt-3">
        <div className="flex items-end gap-2 rounded-xl border border-[#DCE6F2] bg-white px-3 py-2 focus-within:border-[#1468D4]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1000))}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask about heat in Ahmedabad…"
            aria-label="Your question"
            className="max-h-28 min-h-[24px] flex-1 resize-none bg-transparent text-sm leading-6 text-[#13265C] outline-none placeholder:text-[#8A97B1]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1468D4] text-white transition hover:bg-[#0F58B8] disabled:bg-[#DCE6F2] disabled:text-[#8A97B1]"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-[#8A97B1]">
          <span>AMC alert and HeatLens heat stress are different signals.</span>
          <a href={`tel:${EMERGENCY_NUMBER}`} className="flex items-center gap-1 font-semibold text-[#B91C1C] hover:underline">
            <Phone className="h-3 w-3" />
            {EMERGENCY_NUMBER}
          </a>
        </div>
      </form>
    </section>
  )
}
