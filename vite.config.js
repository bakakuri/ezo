import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { siteHtml } from './scripts/site-html.mjs'

// ვერსია შეცდომების ჟურნალისთვის: Vercel-ზე commit-ის პირველი 7 სიმბოლო
const RELEASE = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 7) || 'local'

export default defineConfig({
  plugins: [react(), { name: 'ezo-site', transformIndexHtml: (html) => siteHtml(html) }],
  define: { __EZO_RELEASE__: JSON.stringify(RELEASE) },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
