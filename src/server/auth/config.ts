import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface LocalUser {
  email: string;
  password: string;
  name: string;
  avatarUrl?: string;
}

export interface ProviderConfig {
  label: string;
  /** Provider type — 'form' for local password login, 'oidc' or undefined for OIDC */
  type?: 'form' | 'oidc';
  /** OIDC provider fields */
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  /** Form-based local auth fields */
  users?: LocalUser[];
}

export interface AuthConfig {
  enabled: boolean;
  sessionSecret: string;
  sessionMaxAge?: number;
  adminEmails?: string[];
  providers: Record<string, ProviderConfig>;
}

const configPath = path.join(os.homedir(), '.opencodewiki', 'config.json');

export function isFormProvider(p: ProviderConfig): boolean {
  return p.type === 'form' || !!p.users?.length;
}

export function isOidcProvider(p: ProviderConfig): boolean {
  return (p.type === 'oidc' || (!p.type && !p.users?.length)) && !!p.issuer && !!p.clientId;
}

export async function loadAuthConfig(): Promise<AuthConfig | null> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const auth = parsed.auth;
    if (!auth) return null;
    if (!auth.sessionSecret) {
      console.warn('[auth] config found but missing sessionSecret — auth disabled');
      return null;
    }
    if (!auth.providers || Object.keys(auth.providers).length === 0) {
      console.warn('[auth] config found but no providers defined — auth disabled');
      return null;
    }
    return {
      enabled: auth.enabled !== false,
      sessionSecret: auth.sessionSecret,
      sessionMaxAge: auth.sessionMaxAge ?? 86400000, // default 24h
      adminEmails: auth.adminEmails,
      providers: auth.providers,
    };
  } catch {
    return null;
  }
}
