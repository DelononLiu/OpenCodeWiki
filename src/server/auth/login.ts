import { Router } from 'express';
import type { Request } from 'express';
import crypto from 'crypto';
import type { AuthConfig, ProviderConfig } from './config.js';
import { isFormProvider, isOidcProvider } from './config.js';
import type { OidcProvider } from './providers.js';
import { createOidcProvider, getAuthorizationUrl, handleCallback } from './providers.js';
import { upsertUser, createSession, deleteSession } from './store.js';

const SESSION_COOKIE_NAME = 'ocw_sid';

function providerIcon(key: string, pc: ProviderConfig): string {
  if (isFormProvider(pc)) return '🛡️';
  if (key === 'sso') return '🏢';
  if (key === 'gitlab' || key === 'gitlab-ce') return '🦊';
  if (key === 'azure' || key === 'azure-ad' || key === 'entra') return '☁️';
  if (key === 'okta') return '🔐';
  return '🔑';
}

function loginPageHtml(
  providers: Record<string, ProviderConfig>,
  redirect: string,
  error?: string,
): string {
  const entries = Object.entries(providers);
  const formProviders = entries.filter(([, p]) => isFormProvider(p));
  const oidcProviders = entries.filter(([, p]) => isOidcProvider(p));

  const formSections = formProviders.map(([key, p]) => `
    <form class="login-form" method="post" action="/auth/${encodeURIComponent(key)}/login">
      <div class="form-title">${p.label}</div>
      <input type="hidden" name="redirect" value="${redirect}">
      <input class="form-input" type="email" name="email" placeholder="邮箱" required autofocus>
      <input class="form-input" type="password" name="password" placeholder="密码" required>
      <button class="form-btn" type="submit">登录</button>
    </form>
  `).join('');

  const oidcButtons = oidcProviders.map(([key, p]) =>
    `<a class="provider-btn" href="/auth/${encodeURIComponent(key)}/login?redirect=${encodeURIComponent(redirect)}">
      <span class="provider-icon">${providerIcon(key, p)}</span>
      ${p.label}
    </a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>登录 — OpenCodeWiki</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f5f5f7;--surface:#fff;--border:#e5e7eb;--text:#111;--text2:#555;--text3:#888;--blue:#007aff}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;align-items:center;justify-content:center}
.login-card{background:var(--surface);border-radius:16px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.06);text-align:center;max-width:400px;width:100%}
.login-logo{font-size:28px;font-weight:700;color:var(--blue);margin-bottom:4px}
.login-sub{font-size:13px;color:var(--text3);margin-bottom:20px}
.login-form{text-align:left;margin-bottom:16px}
.form-title{font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px;text-align:left}
.form-input{display:block;width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px;outline:none;transition:border .15s}
.form-input:focus{border-color:var(--blue)}
.form-btn{display:block;width:100%;padding:10px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s}
.form-btn:hover{opacity:.85}
.form-error{background:#fef2f2;color:#dc2626;font-size:13px;padding:8px 12px;border-radius:8px;margin-bottom:12px;text-align:center}
.provider-btn{display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);font-size:14px;color:var(--text);cursor:pointer;text-decoration:none;transition:all .15s;margin-bottom:10px}
.provider-btn:hover{border-color:var(--blue);background:#f5f9ff}
.provider-icon{font-size:18px}
.divider{display:flex;align-items:center;gap:8px;margin:16px 0;color:var(--text3);font-size:12px}
.divider-line{flex:1;height:1px;background:var(--border)}
</style>
</head>
<body>
<div class="login-card">
  <div class="login-logo">OpenCodeWiki</div>
  <div class="login-sub">登录后使用代码问答</div>
  ${error ? `<div class="form-error">${error}</div>` : ''}
  ${formSections}
  ${formSections && oidcButtons ? '<div class="divider"><span class="divider-line"></span><span>或</span><span class="divider-line"></span></div>' : ''}
  ${oidcButtons}
</div>
</body>
</html>`;
}

function resolveRole(email: string, config: AuthConfig): string {
  if (config.adminEmails?.includes(email)) return 'admin';
  return 'user';
}

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();

  // OIDC provider cache (lazy init)
  const oidcProviderMap = new Map<string, OidcProvider>();

  async function getOrInitOidcProvider(key: string): Promise<OidcProvider | null> {
    const cached = oidcProviderMap.get(key);
    if (cached) return cached;
    const pc = config.providers[key];
    if (!pc || !isOidcProvider(pc)) return null;
    try {
      const p = await createOidcProvider(key, pc);
      oidcProviderMap.set(key, p);
      return p;
    } catch (err) {
      console.error(`[auth] failed to init OIDC provider "${key}":`, (err as Error).message);
      return null;
    }
  }

  // ── Login page ──
  router.get('/login', (req, res) => {
    const redirect = (req.query.redirect as string) || '/';
    const error = req.query.error as string | undefined;
    res.type('html').send(loginPageHtml(config.providers, redirect, error));
  });

  // ── Handle provider login ──

  // GET /auth/:provider/login — OIDC redirect
  router.get('/auth/:provider/login', async (req, res) => {
    const providerKey = req.params.provider;
    const pc = config.providers[providerKey];
    if (!pc) return res.status(400).type('text').send('Unknown auth provider');
    if (isFormProvider(pc)) {
      // Form providers don't use GET — redirect to login page
      return res.redirect(`/login?redirect=${encodeURIComponent((req.query.redirect as string) || '/')}`);
    }
    if (isOidcProvider(pc)) {
      // OIDC redirect
      const provider = await getOrInitOidcProvider(providerKey);
      if (!provider) return res.status(400).type('text').send('Failed to initialize OIDC provider');
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/${providerKey}/callback`;
      const state = crypto.randomUUID();
      const authUrl = getAuthorizationUrl(provider, redirectUri, state);
      stateStore.set(state, { redirect: (req.query.redirect as string) || '/', providerKey });
      return res.redirect(authUrl);
    }
    return res.status(400).type('text').send('Misconfigured auth provider');
  });

  // POST /auth/:provider/login — form login
  router.post('/auth/:provider/login', async (req, res) => {
    const providerKey = req.params.provider;
    const pc = config.providers[providerKey];
    if (!pc || !isFormProvider(pc)) {
      return res.status(400).type('text').send('Unknown or misconfigured auth provider');
    }

    const email = req.body?.email as string | undefined;
    const password = req.body?.password as string | undefined;
    const rawRedirect = req.body?.redirect as string | undefined;
    const redirect = rawRedirect || '/';

    if (!email || !password) {
      return res.redirect(`/login?redirect=${encodeURIComponent(redirect)}&error=${encodeURIComponent('请输入邮箱和密码')}`);
    }

    // Find matching user
    const matched = (pc.users || []).find(u => u.email === email && u.password === password);
    if (!matched) {
      return res.redirect(`/login?redirect=${encodeURIComponent(redirect)}&error=${encodeURIComponent('邮箱或密码错误')}`);
    }

    const { id } = upsertUser(providerKey, email, email, matched.name, matched.avatarUrl || null, resolveRole(email, config));
    const session = createSession(id, config.sessionMaxAge!);

    res.cookie(SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: config.sessionMaxAge!,
      path: '/',
    });

    res.redirect(redirect);
  });

  // ── OIDC provider callback ──
  router.get('/auth/:provider/callback', async (req, res) => {
    const providerKey = req.params.provider;
    const provider = await getOrInitOidcProvider(providerKey);
    if (!provider) {
      return res.status(400).type('text').send('Unknown OIDC provider');
    }

    const state = req.query.state as string;
    const stored = stateStore.get(state);
    if (!stored || stored.providerKey !== providerKey) {
      return res.status(400).type('text').send('Invalid state parameter');
    }
    stateStore.delete(state);

    try {
      const redirectUri = `${req.protocol}://${req.get('host')}/auth/${providerKey}/callback`;
      const userInfo = await handleCallback(provider, redirectUri, req.query as Record<string, string>);

      const { id } = upsertUser(providerKey, userInfo.sub, userInfo.email, userInfo.name, userInfo.avatarUrl, resolveRole(userInfo.email, config));
      const session = createSession(id, config.sessionMaxAge!);

      res.cookie(SESSION_COOKIE_NAME, session.sid, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        maxAge: config.sessionMaxAge!,
        path: '/',
      });

      res.redirect(stored.redirect);
    } catch (err) {
      console.error('[auth] callback error:', (err as Error).message);
      res.status(400).type('text').send('Authentication failed: ' + (err as Error).message);
    }
  });

  // ── Logout ──
  router.post('/logout', (req, res) => {
    const sid = readCookie(req, SESSION_COOKIE_NAME);
    if (sid) deleteSession(sid);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.redirect('/login');
  });

  return router;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
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

const stateStore = new Map<string, { redirect: string; providerKey: string }>();
setInterval(() => { if (stateStore.size > 1000) stateStore.clear(); }, 600_000);

export { SESSION_COOKIE_NAME };
