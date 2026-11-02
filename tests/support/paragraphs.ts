import { expect, Page } from '@playwright/test';

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
 * Writes the texts of the list `list` in every language, one at a time as its switch shows
 * them: `write(code, name)` gets the language's code and its name as the editor's tabs give it
 * (e.g. "English"), both in the order of the catalog.
 */
export async function inEachLanguage(
  page: Page,
  list: string,
  write: (code: string, name: string) => Promise<void>,
): Promise<void> {
  const switches = page
    .getByTestId(`draft-${list}`)
    .getByTestId('part-languages')
    .locator('button');
  const tabs = page.getByRole('tab');
  for (let index = 0; index < (await switches.count()); index++) {
    const button = switches.nth(index);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const code = (await button.getAttribute('data-testid'))!.replace('part-language-', '');
    await write(code, (await tabs.nth(index).getAttribute('title')) ?? '');
  }
}

/**
 * Adds a paragraph at the end of the section `section` of the open editor, written in every
 * language as `text(language)` - the language as its tab names it, e.g. "English" - and
 * discovered at the online chapter numbered `chapter`. Its pickers keep to the axes of the
 * first appearance, so that comes first.
 */
export async function addParagraph(
  page: Page,
  section: string,
  text: (language: string) => string,
  chapter: number,
): Promise<void> {
  const list = page.getByTestId(`draft-${section}`);
  const index = await list.getByTestId('part-entry').count();
  await list.getByTestId('part-add').click();
  await rewriteParagraph(page, section, index, text);
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
  await inEachLanguage(page, section, (code, name) =>
    page.locator(`#draft-${section}-${index}-text-${code}`).fill(text(name)),
  );
}
