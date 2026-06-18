import type { Request, Response, NextFunction } from 'express';
import { getSession, getUser, deleteSession } from './store.js';
import type { AuthConfig } from './config.js';

// Extend Express Request to add user
declare module 'express' {
  interface Request {
    user?: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      role: string;
    };
  }
}

const PUBLIC_PATHS = new Set(['/login', '/favicon.ico', '/api/me']);
const PUBLIC_PREFIXES = ['/auth/', '/vendor/'];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix));
}

function isApiPath(path: string): boolean {
  return path.startsWith('/api/');
}

/** Simplified cookie parser — reads a single cookie value by name from the Cookie header. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  // Simple split-based parsing (handles basic cases)
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      let v = part.slice(eq + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return decodeURIComponent(v);
    }
  }
  return undefined;
}

export function createAuthMiddleware(config: AuthConfig, cookieName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.enabled) return next();
    if (isPublicPath(req.path)) return next();

    const sid = readCookie(req, cookieName);
    if (sid) {
      const session = getSession(sid);
      if (session) {
        const user = getUser(session.userId);
        if (user) {
          req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatar_url,
            role: user.role,
          };
          return next();
        }
        deleteSession(sid);
      }
    }

    const redirectParam = encodeURIComponent(req.originalUrl || '/');
    if (isApiPath(req.path)) {
      return res.status(401).json({ error: 'Unauthorized', loginUrl: '/login' });
    }
    return res.redirect(`/login?redirect=${redirectParam}`);
  };
}
