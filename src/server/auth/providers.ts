import { Issuer, generators, Client } from 'openid-client';
import type { ProviderConfig } from './config.js';
import { isOidcProvider } from './config.js';

export interface OidcProvider {
  client: Client;
  config: ProviderConfig;
}

const providerCache = new Map<string, OidcProvider>();

export async function createOidcProvider(key: string, config: ProviderConfig): Promise<OidcProvider> {
  if (!isOidcProvider(config)) {
    throw new Error(`Provider "${key}" is not an OIDC provider (missing issuer/clientId)`);
  }
  const cached = providerCache.get(key);
  if (cached) return cached;

  const issuer = await Issuer.discover(config.issuer!);
  const client = new issuer.Client({
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
  });

  const provider: OidcProvider = { client, config };
  providerCache.set(key, provider);
  return provider;
}

export function getAuthorizationUrl(provider: OidcProvider, redirectUri: string, state: string): string {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const url = provider.client.authorizationUrl({
    redirect_uri: redirectUri,
    scope: provider.config.scopes?.join(' ') || 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  verifierMap.set(state, codeVerifier);
  return url;
}

const verifierMap = new Map<string, string>();

export interface CallbackResult {
  email: string;
  name: string;
  sub: string;
  avatarUrl: string | null;
}

export async function handleCallback(
  provider: OidcProvider,
  redirectUri: string,
  callbackParams: Record<string, string>,
): Promise<CallbackResult> {
  const { state, code } = callbackParams;
  const codeVerifier = verifierMap.get(state);
  if (!codeVerifier) throw new Error('Invalid state — verifier not found');
  verifierMap.delete(state);

  const tokenSet = await provider.client.callback(redirectUri, { code, state }, { code_verifier: codeVerifier });

  const claims = tokenSet.claims();

  const email = claims.email || claims.preferred_username || '';
  if (!email) throw new Error('IdP did not return an email address');

  return {
    email,
    name: claims.name || claims.preferred_username || email,
    sub: claims.sub,
    avatarUrl: claims.picture || null,
  };
}
