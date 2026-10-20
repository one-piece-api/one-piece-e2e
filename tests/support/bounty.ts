import { APIResponse, expect, Page } from '@playwright/test';
import { UploadFile } from './png';
import { Crew, ContentEntity, createDraft } from './story';

export type BountyCondition = 'DEAD_OR_ALIVE' | 'ONLY_ALIVE';

/** What a bounty draft is written with, through the editor or the content API. */
export interface BountyDraft {
  posterName: string;
  amount: number;
  condition?: BountyCondition;
  /** The number of the online chapter that is its first appearance. */
  firstAppearance: number;
  /** The id of the content of the bounty it replaces. */
  previous?: string;
}

/** An amount as the English interface writes its digits: "1,500,000,000". */
export function berryText(amount: number): string {
  return amount.toLocaleString('en-US');
}

/** The label a bounty shows in the English interface: the poster name and the amount. */
export function bountyLabel(posterName: string, amount: number): string {
  return `${posterName} — ${berryText(amount)} ฿`;
}

/** The id of the content on a card's address (`/content/<section>/<id>`). */
export function contentIdOf(page: Page): string {
  return page.url().split('/').pop()!;
}

/**
 * Writes a complete bounty draft in the editor - poster name, amount, condition, an optional
 * poster, the previous bounty picked from the search, the first appearance and a description
 * in every language - and saves it. Leaves the page on the new content's card.
 */
export async function createBounty(
  page: Page,
  draft: BountyDraft & { previousLabel?: string; image?: UploadFile },
): Promise<void> {
  await page.goto('/content/bounties/new');
  await page.locator('#draft-posterName').fill(draft.posterName);
  await page.locator('#draft-amount').fill(String(draft.amount));
  await page
    .locator('#draft-condition')
    .selectOption({ label: draft.condition === 'ONLY_ALIVE' ? 'Only alive' : 'Dead or alive' });
  if (draft.image) {
    await page.locator('#draft-image').setInputFiles(draft.image);
    await expect(page.getByTestId('image-preview')).toBeVisible();
  }
  if (draft.previousLabel) {
    await page.locator('#draft-previous').fill(draft.posterName);
    await page.getByRole('option', { name: draft.previousLabel }).click();
  }
  await page.locator('#draft-firstAppearance').fill(String(draft.firstAppearance));
  await page.getByRole('option', { name: `Ch. ${draft.firstAppearance} —` }).click();
  const tabs = page.getByRole('tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    const tab = tabs.nth(index);
    await tab.click();
    await page
      .locator('#draft-description')
      .fill(`${draft.posterName} wanted, in ${await tab.getAttribute('title')}.`);
  }
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/New draft aboard/)).toBeVisible();
  await expect(page).toHaveURL(/\/bounties\/[0-9a-f-]{36}$/);
}

/** The id of the content of the online chapter numbered `number`, for a first appearance. */
export async function chapterIdOf(page: Page, number: number): Promise<string> {
  const response = await page.request.get(`/api/content/chapters/linkable?q=${number}`);
  expect(response.ok()).toBeTruthy();
  const chapters: { content: { id: string; number: number }[] } = await response.json();
  const chapter = chapters.content.find((listed) => listed.number === number);
  expect(chapter, `chapter ${number} is linkable`).toBeDefined();
  return chapter!.id;
}

/** The body the content API saves a bounty with; `chapter` is a chapter's content id. */
export function bountyBody(
  languages: string[],
  draft: Omit<BountyDraft, 'firstAppearance'> & { chapter: string; inactive?: boolean },
): Record<string, unknown> {
  return {
    posterName: draft.posterName,
    amount: draft.amount,
    condition: draft.condition ?? 'DEAD_OR_ALIVE',
    inactive: draft.inactive ?? false,
    previous: draft.previous,
    firstAppearance: { chapter: draft.chapter },
    translations: Object.fromEntries(
      languages.map((code) => [code, { description: `${draft.posterName} wanted (${code}).` }]),
    ),
  };
}

/** Saves a bounty draft through the content API; the response is the caller's to judge. */
export function saveBounty(page: Page, body: Record<string, unknown>): Promise<APIResponse> {
  return page.request.post('/api/content/bounties', { data: body });
}

/** Drafts a bounty through the content API and returns the id of its content. */
export function draftBounty(crew: Crew, body: Record<string, unknown>): Promise<string> {
  return createDraft(crew.editor, 'bounties' satisfies ContentEntity, body);
}

/** The editorial reading of a bounty: its latest version visible to the caller, `validity` included. */
export async function bountyValidity(page: Page, id: string, version = 1): Promise<string> {
  const response = await page.request.get(`/api/content/bounties/${id}/versions/${version}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).body.validity;
}

/** Opens a new draft of the closed version `basedOn` of a bounty, as the caller. */
export async function openNewVersion(page: Page, id: string, basedOn: number): Promise<void> {
  const response = await page.request.post(`/api/content/bounties/${id}/versions`, {
    data: { basedOn },
  });
  expect(response.status(), await response.text()).toBe(201);
}
