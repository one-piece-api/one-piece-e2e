import { APIResponse, expect, Page } from '@playwright/test';
import { UploadFile } from './png';

/** What an affiliation draft is written with, through the editor. */
export interface AffiliationDraft {
  romaji: string;
  /** The English name; the other languages get their own code appended. */
  name: string;
  /** The number of the online chapter that is its first appearance. */
  firstAppearance: number;
  image?: UploadFile;
}

/**
 * Writes a complete affiliation draft in the editor - romaji, an optional emblem, the first
 * appearance picked from the chapter search, and a name and description in every language -
 * and saves it. Leaves the page on the new content's card.
 */
export async function createAffiliation(page: Page, draft: AffiliationDraft): Promise<void> {
  await page.goto('/content/affiliations/new');
  await page.getByLabel('Romaji').fill(draft.romaji);
  if (draft.image) {
    await page.locator('#draft-image').setInputFiles(draft.image);
    await expect(page.getByTestId('image-preview')).toBeVisible();
  }
  await page.locator('#draft-firstAppearance').fill(String(draft.firstAppearance));
  await page.getByRole('option', { name: `Ch. ${draft.firstAppearance} —` }).click();
  const tabs = page.getByRole('tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    const tab = tabs.nth(index);
    await tab.click();
    const language = await tab.getAttribute('title');
    await page.locator('#draft-name').fill(`${draft.name} (${language})`);
    await page.locator('#draft-description').fill(`${draft.name} described in ${language}.`);
  }
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/New draft aboard/)).toBeVisible();
  await expect(page).toHaveURL(/\/affiliations\/[0-9a-f-]{36}$/);
}

/** The body the content API saves an affiliation with; `chapter` is a chapter's content id. */
export function affiliationBody(
  languages: string[],
  draft: { romaji: string; name: string; chapter: string },
): Record<string, unknown> {
  return {
    romaji: draft.romaji,
    firstAppearance: { chapter: draft.chapter },
    translations: Object.fromEntries(
      languages.map((code) => [
        code,
        { name: `${draft.name} (${code})`, description: `${draft.name} described in ${code}.` },
      ]),
    ),
  };
}

/** Saves an affiliation draft through the content API; the response is the caller's to judge. */
export function saveAffiliation(page: Page, body: Record<string, unknown>): Promise<APIResponse> {
  return page.request.post('/api/content/affiliations', { data: body });
}
