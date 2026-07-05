import { buildApp } from './app.js';
import { env } from './env.js';
import { ensureDataDirs } from './lib/paths.js';

ensureDataDirs();

const app = await buildApp();

try {
  await app.listen({ host: '0.0.0.0', port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
