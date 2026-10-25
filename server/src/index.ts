/** Production server: static build from dist/ plus the API under /api. */
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApi } from './api';
import { cfg, ROOT } from './config';

const app = express();
app.use('/api', createApi());

const dist = resolve(ROOT, 'dist');
if (!existsSync(resolve(dist, 'index.html'))) {
  console.warn('dist/index.html not found. Run `npm run build` first.');
}
app.use(express.static(dist));
app.use((_req, res) => {
  res.sendFile(resolve(dist, 'index.html'));
});

const port = parseInt(process.env.PORT || '8787', 10);
app.listen(port, () => {
  console.log('InterviewFlow AI listening on http://localhost:' + port + ' (' + (cfg.configured ? (cfg.mock ? 'mock Google' : 'Google sign-in configured') : 'demo mode, no Google credentials') + ')');
  if (cfg.configured && !cfg.mock && !cfg.appUrl.includes(':' + port)) {
    console.log('APP_URL is ' + cfg.appUrl + '. The OAuth redirect URI must be ' + cfg.redirectUri);
  }
});
