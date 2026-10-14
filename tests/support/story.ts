import { APIResponse, expect, Page } from '@playwright/test';

/** The story entities, as the content API names them (`/api/content/<entity>`). */
export type StoryEntity = 'sagas' | 'arcs' | 'volumes' | 'chapters' | 'episodes';

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

/** A title and a description in every language, each marked with the language it is in. */
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

/** Saves a new draft through the content API and returns the id of its content. */
export async function createDraft(
  page: Page,
  entity: StoryEntity,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await page.request.post(`/api/content/${entity}`, {
    data: body,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id;
}

async function act(page: Page, entity: StoryEntity, id: string, action: string, version = 1) {
  return page.request.post(`/api/content/${entity}/${id}/versions/${version}/${action}`);
}

/** Submits, claims and approves version `version`, leaving it ready to publish. */
export async function approve(crew: Crew, entity: StoryEntity, id: string, version = 1) {
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
export function publish(crew: Crew, entity: StoryEntity, id: string, version = 1) {
  return act(crew.publisher, entity, id, 'publish', version);
}

/** Retires the online version; the response is the caller's to judge (it may be a 409). */
export function retire(crew: Crew, entity: StoryEntity, id: string, version = 1) {
  return act(crew.publisher, entity, id, 'retire', version);
}

/** Drafts, reviews and publishes in one go; fails unless the content ends up online. */
export async function putOnline(
  crew: Crew,
  entity: StoryEntity,
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
