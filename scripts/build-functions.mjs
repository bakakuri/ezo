// აწყობს Edge Function „game“-ს ერთ ფაილად (თამაშების ძრავებით), რომ Supabase-ის
// ვებ-რედაქტორში ჩასმაც შეიძლებოდეს. გაშვება: npm run build:functions
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('supabase/functions/game', { recursive: true })
await build({
  entryPoints: ['supabase/functions-src/game.ts'],
  outfile: 'supabase/functions/game/index.ts',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['npm:*', 'jsr:*'],
  banner: { js: '// ავტომატურად აწყობილი ფაილი — წყარო: supabase/functions-src/game.ts (npm run build:functions)' },
  logLevel: 'info',
})
