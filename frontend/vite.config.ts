import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // IMPLEMENTATION_PLAN.md §3, §10 — dev-time proxy to the FastAPI backend.
      '/api': {
        // HEATLENS_API_URL lets a second dev copy point at another backend port; default 8000.
        target: process.env.HEATLENS_API_URL ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
