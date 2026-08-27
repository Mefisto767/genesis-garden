import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages отдаёт сайт с подпути /genesis-garden/
  base: '/genesis-garden/',
  plugins: [react()],
})
