/**
 * Route-level error boundary (react-router's `errorElement`). A rendering bug in
 * one page must not white-screen the whole app — and must never leave a demo
 * staring at a blank tab.
 */
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

export default function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <div role="alert" className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-[#6B7A99]">{message}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-[#DCE3EE] px-4 py-2 text-sm font-medium hover:bg-[#F8FAFD]"
        >
          Reload
        </button>
        <Link
          to="/"
          className="rounded-lg bg-[#13265C] px-4 py-2 text-sm font-medium text-white hover:bg-[#0E1D49]"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
