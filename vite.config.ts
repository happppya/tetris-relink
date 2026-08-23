import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/; override locally when needed
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
