import { expect, Locator, Page } from '@playwright/test';
import { UploadFile } from './png';

/**
 * Writes a complete Devil Fruit Type draft - a romaji and, in every language of the catalog, a
 * name, a description, advantages and disadvantages - and saves it: review only takes a complete draft. Leaves the page
 * on the new content's card.
 */
export async function createFruitType(page: Page, name: string): Promise<void> {
  await page.goto('/content/devil-fruit-types/new');
  await page.getByLabel('Romaji').fill(`${name}-kei`);
  await fillEveryLanguage(page, name, 'Written by the e2e suite');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/New draft aboard/)).toBeVisible();
  await expect(page).toHaveURL(/\/devil-fruit-types\/[0-9a-f-]{36}$/);
}

/**
 * Writes a complete Devil Fruit draft - a romaji, an image, the type named `typeName` picked
 * from the type search, and every language filled - and saves it. Leaves the page on the new
 * content's card.
 */
export async function createDevilFruit(
  page: Page,
  name: string,
  typeName: string,
  image: UploadFile,
): Promise<void> {
  await page.goto('/content/devil-fruits/new');
  await page.getByLabel('Romaji').fill(`${name} no Mi`);
  await page.locator('#draft-image').setInputFiles(image);
  await expect(page.getByTestId('image-preview')).toBeVisible();
  await page.locator('#draft-type').fill(typeName);
  await page.getByRole('option', { name: englishName(typeName) }).click();
  await fillEveryLanguage(page, name, 'Written by the e2e suite');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/New draft aboard/)).toBeVisible();
  await expect(page).toHaveURL(/\/devil-fruits\/[0-9a-f-]{36}$/);
}

/** Fills every translated field of the draft in every language tab of the editor. */
export async function fillEveryLanguage(page: Page, name: string, description: string) {
  const tabs = page.getByRole('tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    const tab = tabs.nth(index);
    await tab.click();
    const language = await tab.getAttribute('title');
    await page.locator('#draft-name').fill(`${name} (${language})`);
    await page.locator('#draft-description').fill(`${description} in ${language}.`);
    await page.locator('#draft-advantages').fill(`Advantages in ${language}.`);
    await page.locator('#draft-disadvantages').fill(`Disadvantages in ${language}.`);
  }
}

/** The name a content shows to a reader of the English interface. */
export function englishName(name: string): string {
  return `${name} (English)`;
}

/**
 * Takes an action from the editorial route map of the card's Workflow tab - each node the
 * caller may move to is a button titled "Click to: <action> · <meaning>".
 */
export async function actOnRoute(page: Page, action: string): Promise<void> {
  await page.getByRole('tab', { name: /Workflow/ }).click();
  await page.getByRole('button', { name: new RegExp(`^Click to: ${action}`) }).click();
}

/** The actions the card's Workflow tab names as unavailable now, each with its reason. */
export async function blockedActions(page: Page, card: string): Promise<Locator> {
  await page.goto(card);
  await page.getByRole('tab', { name: /Workflow/ }).click();
  return page.getByTestId('blocked-action');
}

/** The row of a status page naming the content. */
export function statusRow(page: Page, name: string): Locator {
  return page.getByTestId('status-row').filter({ hasText: englishName(name) });
}

/** Takes an action straight from the row of a status page. */
export async function actOnRow(page: Page, status: string, name: string, action: string) {
  await page.goto(`/dashboard/${status}`);
  await statusRow(page, name).locator(`[data-action="${action}"]`).click();
}

/** Confirms the dialog an irreversible action opens. */
export async function confirm(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Yes, / }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * The Den Den Mushi's message bubble - a `status` for outcomes, an `alert` for errors; the
 * page may hold other live regions.
 */
export function denDenMushi(page: Page): Locator {
  return page
    .getByRole('status')
    .or(page.getByRole('alert'))
    .filter({ has: page.getByRole('button', { name: /Den Den Mushi/ }) });
}
