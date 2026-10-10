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

export interface PublicSubcategory {
  id: string;
  name: string;
  description?: string;
}

export interface PublicDevilFruit {
  id: string;
  slug: string;
  name: string;
  /** Relative to the API root, e.g. `v1/images/<id>.png`. */
  image: string;
  type: PublicFruitType;
  subcategory: PublicSubcategory | null;
}

export interface PublicFruitTypeDetail extends PublicFruitType {
  subcategories: PublicSubcategory[];
  devilFruits: Omit<PublicDevilFruit, 'type'>[];
}

export function devilFruitPath(language: string, idOrSlug = ''): string {
  return `/v1/${language}/devil-fruits${idOrSlug ? `/${idOrSlug}` : ''}`;
}

export function fruitTypePath(language: string, idOrSlug: string): string {
  return `/v1/${language}/devil-fruit-types/${idOrSlug}`;
}
