// Packages the app for Vercel (Build Output API v3), run after `vite build`:
// dist/ becomes the static site, and the API is bundled into one serverless function at /api.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output';
const fn = out + '/functions/api.func';
rmSync(out, { recursive: true, force: true });
cpSync('dist', out + '/static', { recursive: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ['server/src/vercel.ts'],
  outfile: fn + '/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Express and friends are CommonJS and require() Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

const json = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2));
// Sync fetches and classifies up to GMAIL_MAX_MESSAGES messages, so allow more than the default time.
json(fn + '/.vc-config.json', { runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 });
json(out + '/config.json', {
  version: 3,
  routes: [{ src: '^/api(?:/.*)?$', dest: '/api' }, { handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }],
});
console.log('Vercel output written to ' + out);
