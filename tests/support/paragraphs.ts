import { Page } from '@playwright/test';

/**
 * Picks an online chapter by its number in the chapter search box of this id: the first
 * appearance, or a point of a window (`draft-species-0-discovered`).
 */
export async function pickChapter(page: Page, boxId: string, chapter: number): Promise<void> {
  await page.locator(`#${boxId}`).fill(String(chapter));
  await page
    .locator(`#${boxId}-listbox`)
    .getByRole('option', { name: `Ch. ${chapter} —` })
    .click();
}

/** A point of the story as the content API takes it, by content ids. */
export interface StoryPointIds {
  chapter?: string;
  episode?: string;
}

/**
 * A section of one paragraph as the content API takes it: its text in every language,
 * `text(code)`, discovered at `discovered`, never ended. Review asks a section for one
 * paragraph discovered at the first appearance (a Saga or an Arc: anywhere).
 */
export function paragraphsOf(
  languages: string[],
  text: (code: string) => string,
  discovered: StoryPointIds,
): { text: Record<string, string>; discovered: StoryPointIds; ended: null }[] {
  return [
    {
      text: Object.fromEntries(languages.map((code) => [code, text(code)])),
      discovered,
      ended: null,
    },
  ];
}

/**
 * Adds a paragraph at the end of the section `section` of the open editor, written in every
 * language as `text(language)` - the language as its tab names it, e.g. "English" - and
 * discovered at the online chapter numbered `chapter`. Its boxes follow the order of the
 * language tabs; its pickers keep to the axes of the first appearance, so that comes first.
 */
export async function addParagraph(
  page: Page,
  section: string,
  text: (language: string) => string,
  chapter: number,
): Promise<void> {
  const list = page.getByTestId(`draft-${section}`);
  const tabs = page.getByRole('tab');
  const languages = await tabs.count();
  const index = (await list.locator('textarea').count()) / languages;
  await list.getByTestId('part-add').click();
  const boxes = list.locator(`textarea[id^="draft-${section}-${index}-text-"]`);
  for (let language = 0; language < languages; language++) {
    await boxes.nth(language).fill(text((await tabs.nth(language).getAttribute('title')) ?? ''));
  }
  await pickChapter(page, `draft-${section}-${index}-discovered`, chapter);
}

/**
 * Writes paragraph `index` of the section `section` again, in every language, as
 * `text(language)`; its window stays as it was.
 */
export async function rewriteParagraph(
  page: Page,
  section: string,
  index: number,
  text: (language: string) => string,
): Promise<void> {
  const tabs = page.getByRole('tab');
  const boxes = page
    .getByTestId(`draft-${section}`)
    .locator(`textarea[id^="draft-${section}-${index}-text-"]`);
  for (let language = 0; language < (await tabs.count()); language++) {
    await boxes.nth(language).fill(text((await tabs.nth(language).getAttribute('title')) ?? ''));
  }
}
