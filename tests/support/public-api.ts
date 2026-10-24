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
  /** Relative to the API root, e.g. `v1/images/<id>`. */
  image: string;
  type: PublicFruitType;
  subcategory: PublicSubcategory | null;
}

/** A fruit with whether several characters may have it, and who has eaten it: current users first. */
export interface PublicDevilFruitDetail extends PublicDevilFruit {
  multipleUsers: boolean;
  users: { character: { id: string; slug: string; name: string }; former: boolean }[];
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

/** The public address of a story entity (`sagas`, `arcs`, ...), a listing or one slug / id. */
export function storyPath(language: string, entity: string, idOrSlug = ''): string {
  return `/v1/${language}/${entity}${idOrSlug ? `/${idOrSlug}` : ''}`;
}

export interface PublicStorySpan {
  count: number;
  firstNumber: number | null;
  lastNumber: number | null;
  firstDate: string | null;
  lastDate: string | null;
}

export interface PublicBountyLink {
  id: string;
  slug: string;
  posterName: string;
  amount: number;
  condition: 'DEAD_OR_ALIVE' | 'ONLY_ALIVE';
  validity: 'ACTIVE' | 'SUPERSEDED' | 'INACTIVE';
  /** Relative to the API root, e.g. `v1/images/<id>`; null without a poster. */
  image: string | null;
  /** The character the poster is about; null when none. */
  holder: { id: string; slug: string; name: string } | null;
}

export interface PublicBounty extends PublicBountyLink {
  description: string;
  /** The whole chain of the person's posters, newest first, itself included. */
  chain: PublicBountyLink[];
}

/** The public address of the bounties, a listing or one slug / id. */
export function bountyPath(language: string, idOrSlug = ''): string {
  return `/v1/${language}/bounties${idOrSlug ? `/${idOrSlug}` : ''}`;
}

export interface PublicAffiliationSummary {
  id: string;
  slug: string;
  romaji: string;
  name: string;
  /** Null for a version written before kinds existed. */
  kind: string | null;
  /** Relative to the API root, e.g. `v1/images/<id>`; null without an emblem. */
  image: string | null;
}

export interface PublicAffiliation extends PublicAffiliationSummary {
  language: string;
  description: string;
  firstAppearance: { chapter: { number: number } | null; episode: { number: number } | null };
}

/** The public address of the affiliations, a listing or one slug / id. */
export function affiliationPath(language: string, idOrSlug = ''): string {
  return `/v1/${language}/affiliations${idOrSlug ? `/${idOrSlug}` : ''}`;
}

export interface PublicSpeciesSummary {
  id: string;
  slug: string;
  romaji: string;
  name: string;
  /** Relative to the API root, e.g. `v1/images/<id>`; null without a picture. */
  image: string | null;
}

export interface PublicSpecies extends PublicSpeciesSummary {
  language: string;
  description: string;
  firstAppearance: { chapter: { number: number } | null; episode: { number: number } | null };
}

/** The public address of the species (singular and plural alike), a listing or one slug / id. */
export function speciesPath(language: string, idOrSlug = ''): string {
  return `/v1/${language}/species${idOrSlug ? `/${idOrSlug}` : ''}`;
}

export interface PublicCharacterSummary {
  id: string;
  slug: string;
  romaji: string;
  name: string;
  status: string;
  /** Relative to the API root, e.g. `v1/images/<id>`; null without a portrait. */
  image: string | null;
}

export interface PublicCharacter extends PublicCharacterSummary {
  language: string;
  japaneseName: string | null;
  description: string;
  gender: string;
  /** ISO 8601 day and month, e.g. `--05-05`. */
  birthday: string | null;
  /** In the language of the reader, in the version's order. */
  epithets: string[];
  aliases: string[];
  species: { id: string; slug: string; name: string }[];
  /** Its memberships, in the editor's order; the role in the language of the reader. */
  affiliations: {
    affiliation: { id: string; slug: string; name: string; kind: string | null };
    role: string | null;
    marineRank: string | null;
    former: boolean;
  }[];
  /** Its Devil Fruits, in the editor's order. */
  devilFruits: { devilFruit: { id: string; slug: string; name: string }; former: boolean }[];
  /** Its relatives, whichever of the two characters stores the tie; `kind` is read from this side. */
  relatives: {
    character: { id: string; slug: string; name: string; gender: string };
    kind: string;
  }[];
  /** Its bounties online, highest amount first. */
  bounties: { id: string; slug: string; amount: number; validity: PublicBountyLink['validity'] }[];
  firstAppearance: { chapter: { number: number } | null; episode: { number: number } | null };
}

/** The public address of the characters, a listing or one slug / id. */
export function characterPath(language: string, idOrSlug = ''): string {
  return `/v1/${language}/characters${idOrSlug ? `/${idOrSlug}` : ''}`;
}
