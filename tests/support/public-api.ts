import { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * The public read API, reached through the gateway exactly like on the remote
 * (onepiece-infrastructure ADR-0024): a port-forward to Envoy's Service, and the API's own
 * host in the `Host` header - `api.localhost` locally and in CI, where there is no domain.
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8090';
const API_HOST = process.env.E2E_API_HOST ?? 'api.localhost';

export interface PublicFruitType {
  id: string;
  slug: string;
  romaji: string;
  name: string;
}

/** GETs a public API path without following redirects, so a `301` stays observable. */
export function getPublic(request: APIRequestContext, path: string): Promise<APIResponse> {
  return request.get(`${API_URL}${path}`, { headers: { Host: API_HOST }, maxRedirects: 0 });
}

export function fruitTypePath(language: string, idOrSlug: string): string {
  return `/v1/${language}/devil-fruit-types/${idOrSlug}`;
}
