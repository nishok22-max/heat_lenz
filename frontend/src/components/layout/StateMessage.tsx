/**
 * Loading / error / empty states — one component so every page fails the same,
 * readable way. A skeleton is used while loading so the layout does not jump.
 */
import { ApiError } from '../../api/client'

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-[#E9EEF5] ${className}`}
    />
  )
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

interface ErrorProps {
  error: unknown
  /** Plain-language framing, e.g. "Could not load the forecast." */
  title: string
  onRetry?: () => void
  className?: string
}

/** Shows the server's own message for a 4xx (it explains coverage); a generic one otherwise. */
export function ErrorMessage({ error, title, onRetry, className = '' }: ErrorProps) {
  // A 4xx is the server's considered answer ("no data for that date"); asking again cannot change it.
  const retryable = !(error instanceof ApiError && error.status < 500)
  const detail =
    error instanceof ApiError && error.status < 500
      ? error.message
      : error instanceof ApiError
        ? 'The server or an upstream data source (Open-Meteo) is unavailable. Try again shortly.'
        : 'The backend could not be reached. Is it running?'
  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-200 bg-red-50 p-4 text-sm ${className}`}
    >
      <p className="font-medium text-red-800">{title}</p>
      <p className="mt-1 text-red-700">{detail}</p>
      {onRetry && retryable && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#DCE3EE] p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-[#6B7A99]">{children}</div>}
    </div>
  )
}
