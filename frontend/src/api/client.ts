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

export const BASE_URL = '/api/v1'

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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw await toApiError(res)
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toApiError(res)
  return res.json() as Promise<T>
}
