/**
 * Client for the HeatLens assistant (backend/app/chat). The answer arrives as Server-Sent Events
 * over a POST, so it is read from the response stream rather than with EventSource (GET only).
 *
 * The session ID lives in sessionStorage: closing the tab ends the chat. Ward and language are
 * kept across visits only if the user ticks "remember", in localStorage on their own device, and
 * the server validates them again each time.
 */
import { BASE_URL } from '../api/client'

export type Audience = 'public' | 'authority'

export interface ChatMemory {
  ward_id?: string
  ward_name?: string
  role?: string
  language?: string
  detail?: string
  group?: string
}

export type ChatEvent =
  | { type: 'session'; session_id: string }
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'retract' }
  | { type: 'memory'; memory: ChatMemory }
  | {
      type: 'done'
      blocked: string | null
      memory: ChatMemory
      sources?: string[]
      cached?: boolean
      first_text_ms?: number | null
      total_ms: number
    }

const SID_KEY = 'heatlens.chat.session'
const PROFILE_KEY = 'heatlens.chat.profile'

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function safeSet(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, value)
  } catch {
    // private mode or blocked storage: the chat still works, it just forgets sooner
  }
}

export const sessionId = {
  get: () => safeGet(() => sessionStorage, SID_KEY),
  set: (id: string | null) => safeSet(() => sessionStorage, SID_KEY, id),
}

export interface DeviceProfile {
  ward_id?: string
  language?: string
}

export const deviceProfile = {
  get(): DeviceProfile | null {
    const raw = safeGet(() => localStorage, PROFILE_KEY)
    if (!raw) return null
    try {
      const p = JSON.parse(raw) as DeviceProfile
      return { ward_id: p.ward_id, language: p.language }
    } catch {
      return null
    }
  },
  set(p: DeviceProfile | null) {
    safeSet(() => localStorage, PROFILE_KEY, p ? JSON.stringify({ ward_id: p.ward_id, language: p.language }) : null)
  },
}

/** Send one message; calls onEvent for each event as it arrives. Resolves when the stream ends. */
export async function sendChat(
  message: string,
  audience: Audience,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const profile = deviceProfile.get()
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message,
      audience,
      session_id: sessionId.get() ?? undefined,
      profile: profile && (profile.ward_id || profile.language) ? profile : undefined,
    }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`The assistant is unavailable (HTTP ${res.status}).`)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const event = JSON.parse(line.slice(6)) as ChatEvent
        if (event.type === 'session') sessionId.set(event.session_id)
        onEvent(event)
      }
    }
  }
}

export async function clearChat(): Promise<void> {
  const id = sessionId.get()
  sessionId.set(null)
  if (id) await fetch(`${BASE_URL}/chat/session/${id}`, { method: 'DELETE' }).catch(() => undefined)
}
