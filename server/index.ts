import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app';

const app = createApp();
const production = process.env.NODE_ENV === 'production';
if (production) {
  app.use(express.static(resolve('dist'), { index: false, maxAge: '1h', setHeaders(res, file) {
    if (/\/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.info(`Kelionės vertėjas: http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY) console.info('Set OPENAI_API_KEY in .env to enable voice, photo translation and chat.');
});
async function shutdown() {
  await app.locals.closeSessions();
  await app.locals.closeStats();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
