import type { Express } from 'express';
import { loadAuthConfig } from './config.js';
import { createAuthMiddleware } from './middleware.js';
import { createAuthRouter, SESSION_COOKIE_NAME } from './login.js';

export async function setupAuth(app: Express): Promise<boolean> {
  const config = await loadAuthConfig();
  if (!config) {
    console.log('[auth] not configured — all routes open');
    return false;
  }

  console.log(`[auth] enabled — ${Object.keys(config.providers).length} provider(s): ${Object.keys(config.providers).join(', ')}`);

  // Mount auth routes first (before auth middleware so they are reachable without auth)
  const authRouter = createAuthRouter(config);
  app.use(authRouter);

  // Protect all subsequent routes
  app.use(createAuthMiddleware(config, SESSION_COOKIE_NAME));

  return true;
}
