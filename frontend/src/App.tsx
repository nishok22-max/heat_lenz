import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ApiError } from './api/client'
import { router } from './routes'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 404/422 is the server's considered answer ("no data for that date"), not a
      // flake: retrying it just delays the message by several seconds. Only retry
      // network failures and 5xx (e.g. Open-Meteo briefly unavailable), and only twice.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

export default App
