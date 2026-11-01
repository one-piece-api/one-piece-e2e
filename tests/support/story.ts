import { APIResponse, expect, Page } from '@playwright/test';
import { paragraphsOf } from './paragraphs';

/** The story entities, as the content API names them (`/api/content/<entity>`). */
export type StoryEntity = 'sagas' | 'arcs' | 'volumes' | 'chapters' | 'episodes';

/** Every entity the helpers below move through the workflow: the story ones, the Devil Fruits and their types, the bounties, the affiliations, the species and the characters. */
export type ContentEntity =
  | StoryEntity
  | 'devil-fruit-types'
  | 'devil-fruits'
  | 'bounties'
  | 'affiliations'
  | 'species'
  | 'characters';

/** Who moves a draft along its way to "online" - one identity per role, as in the UI specs. */
export interface Crew {
  editor: Page;
  reviewer: Page;
  publisher: Page;
}

/** A number no earlier run used: story numbers are unique across every version, forever. */
export function freshNumber(offset = 0): number {
  return Math.floor(Date.now() / 1000) + offset;
}

/** The codes of the languages every translated field must be written in. */
export async function languageCodes(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/content/languages');
  expect(response.ok()).toBeTruthy();
  const languages: { code: string }[] = await response.json();
  return languages.map((language) => language.code);
}

/**
 * A title and a description in every language, each marked with the language it is in: a
 * volume, a chapter, an episode.
 */
export function translationsOf(
  languages: string[],
  title: string,
): Record<string, { title: string; description: string }> {
  return Object.fromEntries(
    languages.map((code) => [
      code,
      {
        title: `${title} (${code})`,
        description: `${title} described in ${code}.`,
      },
    ]),
  );
}

/** A title in every language, marked with the language it is in: a Saga, an Arc. */
export function titlesOf(languages: string[], title: string): Record<string, { title: string }> {
  return Object.fromEntries(languages.map((code) => [code, { title: `${title} (${code})` }]));
}

/**
 * The description of a Saga or an Arc: one paragraph in every language, discovered at the
 * chapter whose content id is `chapter` - any chapter, approved before the item goes online.
 */
export function storyDescriptionOf(languages: string[], title: string, chapter: string) {
  return paragraphsOf(languages, (code) => `${title} described in ${code}.`, { chapter });
}

/** Saves a new draft through the content API and returns the id of its content. */
export async function createDraft(
  page: Page,
  entity: ContentEntity,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await page.request.post(`/api/content/${entity}`, {
    data: body,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id;
}

async function act(page: Page, entity: ContentEntity, id: string, action: string, version = 1) {
  return page.request.post(`/api/content/${entity}/${id}/versions/${version}/${action}`);
}

/** Submits, claims and approves version `version`, leaving it ready to publish. */
export async function approve(crew: Crew, entity: ContentEntity, id: string, version = 1) {
  for (const [page, action] of [
    [crew.editor, 'submit'],
    [crew.reviewer, 'claim'],
    [crew.reviewer, 'approve'],
  ] as const) {
    const response = await act(page, entity, id, action, version);
    expect(response.status(), `${action}: ${await response.text()}`).toBeLessThan(300);
  }
}

/** Publishes an approved version; the response is the caller's to judge (it may be a 409). */
export function publish(crew: Crew, entity: ContentEntity, id: string, version = 1) {
  return act(crew.publisher, entity, id, 'publish', version);
}

/** Retires the online version; the response is the caller's to judge (it may be a 409). */
export function retire(crew: Crew, entity: ContentEntity, id: string, version = 1) {
  return act(crew.publisher, entity, id, 'retire', version);
}

/** Drafts, reviews and publishes in one go; fails unless the content ends up online. */
export async function putOnline(
  crew: Crew,
  entity: ContentEntity,
  body: Record<string, unknown>,
): Promise<string> {
  const id = await createDraft(crew.editor, entity, body);
  await approve(crew, entity, id);
  const response = await publish(crew, entity, id);
  expect(response.status(), await response.text()).toBe(200);
  return id;
}

/** The reason a refused action names (`reason` of the 409 problem detail, next to its `errorCode`). */
export async function reasonOf(response: APIResponse): Promise<string> {
  const problem = await response.json();
  return problem.reason;
}

/** Saves version `version` of a draft again with `body`; fails unless the content API takes it. */
export async function editDraft(
  page: Page,
  entity: ContentEntity,
  id: string,
  body: Record<string, unknown>,
  version = 1,
): Promise<void> {
  const response = await page.request.put(`/api/content/${entity}/${id}/versions/${version}`, {
    data: body,
  });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * A chapter online, with the saga and arc it needs, for contents to name as their first
 * appearance - required to submit a Devil Fruit or its type. Returns its number. Works on an
 * empty catalog: the saga and the arc describe the story from this very chapter, which passes
 * review only within an approved arc - so it is drafted first, without its arc, and put in
 * its arc once that is approved; each goes online once what it points to is approved.
 */
export async function onlineChapter(crew: Crew): Promise<number> {
  const number = freshNumber();
  const languages = await languageCodes(crew.editor);
  const title = `E2E Story ${number}`;
  const chapterBody = {
    number,
    releases: [{ country: 'JP', date: '2020-05-01' }],
    translations: translationsOf(languages, title),
  };
  const chapter = await createDraft(crew.editor, 'chapters', chapterBody);
  const story = {
    number,
    translations: titlesOf(languages, title),
    description: storyDescriptionOf(languages, title, chapter),
  };
  const saga = await createDraft(crew.editor, 'sagas', story);
  await approve(crew, 'sagas', saga);
  const arc = await createDraft(crew.editor, 'arcs', { ...story, saga });
  await approve(crew, 'arcs', arc);
  await editDraft(crew.editor, 'chapters', chapter, { ...chapterBody, arc });
  await approve(crew, 'chapters', chapter);
  for (const [entity, id] of [
    ['sagas', saga],
    ['arcs', arc],
    ['chapters', chapter],
  ] as const) {
    const response = await publish(crew, entity, id);
    expect(response.status(), `${entity}: ${await response.text()}`).toBe(200);
  }
  return number;
}
