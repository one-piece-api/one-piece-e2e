import { APIResponse, expect, Page } from '@playwright/test';
import { UploadFile } from './images';
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

/** The last number `freshNumber` gave in this run. */
let lastFreshNumber = 0;

/**
 * A number no earlier run used: story numbers are unique across every version, forever. The
 * seconds of the clock, never the same twice in a run - two chapters made within one second
 * would otherwise share it. A caller that also uses the `reserve` numbers after the one it gets
 * (`n + 1`...) asks for them here, so no later call hands them out again - the counter can be
 * ahead of the clock after a spec that made many.
 */
export function freshNumber(reserve = 0): number {
  const first = Math.max(lastFreshNumber + 1, Math.floor(Date.now() / 1000));
  lastFreshNumber = first + reserve;
  return first;
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
  return paragraphsOf(languages, (code) => `${title} described in ${code}.`, {
    chapter,
  });
}

/**
 * The files a body sends next to its JSON, in the order its `upload: n` entries count them: a
 * character's gallery. A symbol key, so that a spread copies it and the JSON leaves it out.
 */
export const UPLOADS = Symbol('uploads');

/** A body the content API saves, with the files it uploads where it has any. */
export type ContentBody = Record<string, unknown> & {
  [UPLOADS]?: UploadFile[];
};

/** The multipart part each upload of a gallery travels in (content-service, reveals plan R5). */
const UPLOAD_PART = 'images';

/**
 * The options a save sends a body with: plain JSON, or - when it uploads files - the JSON as
 * the part `version` and every file as a part `images`, in order.
 */
export function contentRequest(body: ContentBody): { data: ContentBody } | { multipart: FormData } {
  const files = body[UPLOADS] ?? [];
  if (files.length === 0) {
    return { data: body };
  }
  const form = new FormData();
  form.append(
    'version',
    new Blob([JSON.stringify(body)], { type: 'application/json' }),
    'version.json',
  );
  for (const file of files) {
    form.append(UPLOAD_PART, new Blob([file.buffer], { type: file.mimeType }), file.name);
  }
  return { multipart: form };
}

/** Saves a new draft through the content API and returns the id of its content. */
export async function createDraft(
  page: Page,
  entity: ContentEntity,
  body: ContentBody,
): Promise<string> {
  const response = await page.request.post(`/api/content/${entity}`, contentRequest(body));
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
  body: ContentBody,
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
  body: ContentBody,
  version = 1,
): Promise<void> {
  const response = await page.request.put(
    `/api/content/${entity}/${id}/versions/${version}`,
    contentRequest(body),
  );
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

/** The id of the arc a chapter online belongs to, from its version. */
export async function arcOf(page: Page, chapterId: string): Promise<string> {
  const response = await page.request.get(`/api/content/chapters/${chapterId}/versions/1`);
  expect(response.ok()).toBeTruthy();
  const arc = (await response.json()).body.arc;
  return typeof arc === 'string' ? arc : arc.id;
}
