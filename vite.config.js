import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { siteHtml } from './scripts/site-html.mjs'

// ვერსია შეცდომების ჟურნალისთვის: Vercel-ზე commit-ის პირველი 7 სიმბოლო
const RELEASE = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 7) || 'local'

export default defineConfig(({ mode }) => {
  // დემო თუ ნამდვილი — იგივე წესით, რაც src/lib/supabase.js-ში (DEMO); აწყობაში მხოლოდ ერთი API ხვდება
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const demo = env.VITE_DEMO === '1' || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY
  const impl = fileURLToPath(new URL(`./src/lib/api.${demo ? 'demo' : 'supabase'}.js`, import.meta.url))

  return {
    plugins: [react(), { name: 'ezo-site', transformIndexHtml: (html) => siteHtml(html) }],
    define: { __EZO_RELEASE__: JSON.stringify(RELEASE) },
    resolve: { alias: { 'ezo-api-impl': impl } },
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
  }
})
