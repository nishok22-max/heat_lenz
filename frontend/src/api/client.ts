/**
 * Thin fetch wrapper for the HeatLens API.
 * IMPLEMENTATION_PLAN.md §3, §6.1 — TanStack Query owns caching/retry on top
 * of this; this module only knows how to make one HTTP call and parse JSON.
 *
 * Requests go to '/api/v1/...', proxied to the FastAPI backend by Vite's dev
 * server (vite.config.ts) and by the production reverse proxy.
 */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api/v1'

/** FastAPI errors are `{"detail": "..."}` (or a list for 422s); show that, not the raw JSON. */
async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '')
  let message = text || res.statusText
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail
    if (typeof detail === 'string') message = detail
    else if (Array.isArray(detail)) {
      message = detail
        .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join('; ')
    }
  } catch {
    // not JSON — keep the raw text
  }
  return new ApiError(res.status, message)
}

function resolveMockPath(path: string): string {
  // Convert e.g. /forecast/ahmedabad?days=5 -> mock-api/forecast/ahmedabad_days_5.json
  const clean = path.replace(/^\//, '').replace(/[\?&=]/g, '_')
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${base}mock-api/${clean}.json`
}

export async function apiGet<T>(path: string): Promise<T> {
  try {
    const res = await fetch(`${BASE_URL}${path}`)
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as T
  } catch (err) {
    // Fallback to static mock-api snapshot (essential for static hosting like GitHub Pages)
    try {
      const mockUrl = resolveMockPath(path)
      const mockRes = await fetch(mockUrl)
      if (mockRes.ok) {
        return (await mockRes.json()) as T
      }
    } catch {
      // ignore mock fetch error
    }
    throw err
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as T
  } catch (err) {
    if (path === '/chat') {
      return {
        reply:
          'Hello! I am the HeatLens AI Assistant. When running on GitHub Pages static demo, the live AI model backend is in preview mode. To test full conversational Q&A, run the FastAPI backend locally or configure VITE_API_URL.',
        evidence: 'preview',
        suggested_actions: [
          'Stay hydrated with electrolyte solutions (ORS / nimbu pani)',
          'Avoid direct sun exposure between 12:00 PM and 4:00 PM',
          'Ensure adequate ventilation in indoor resting areas',
        ],
      } as unknown as T
    }
    throw err
  }
}
