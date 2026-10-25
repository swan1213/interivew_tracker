/** Vercel function entry: the API under /api. Bundled by scripts/vercel-build.mjs. */
import express from 'express';
import { createApi } from './api';

const app = express();
app.use('/api', createApi());

export default app;
