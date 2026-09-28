import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-[#6B7A99]">That address does not match any HeatLens page.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-[#13265C] px-4 py-2 text-sm font-medium text-white hover:bg-[#0E1D49]"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
