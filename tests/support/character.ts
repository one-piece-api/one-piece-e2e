import { APIResponse, expect, Page } from '@playwright/test';
import { UploadFile } from './png';

/** What a character draft is written with, through the editor. */
export interface CharacterDraft {
  romaji: string;
  /** The name; every language gets its own code appended. */
  name: string;
  japaneseName: string;
  status: 'ALIVE' | 'DECEASED' | 'UNKNOWN';
  gender: 'MALE' | 'FEMALE' | 'UNKNOWN';
  birthday: { day: number; month: number };
  /** The number of the online chapter that is its first appearance. */
  firstAppearance: number;
  image: UploadFile;
  /** The base text of each epithet, in order; every language gets its own code appended. */
  epithets: string[];
  aliases: string[];
  /** The names of the online species, in the order the character shows them. */
  species: string[];
}

/** The text an epithet or a name is written with in one language. */
export function inLanguage(text: string, language: string): string {
  return `${text} (${language})`;
}

/**
 * Writes a complete character draft in the editor - romaji, Japanese name, portrait, status,
 * gender, birthday, the species picked from the search, first appearance, epithets in every
 * language, aliases, and a name and description in every language - and saves it. The two
 * first species are added swapped and put right with the entry's "up" button, so the order
 * is the editor's own. Leaves the page on the new content's card.
 */
export async function createCharacter(
  page: Page,
  languages: string[],
  draft: CharacterDraft,
): Promise<void> {
  await page.goto('/content/characters/new');
  await page.getByLabel('Romaji').fill(draft.romaji);
  await page.locator('#draft-japaneseName').fill(draft.japaneseName);
  await page.locator('#draft-image').setInputFiles(draft.image);
  await expect(page.getByTestId('image-preview')).toBeVisible();
  await page.locator('#draft-status').selectOption(draft.status);
  await page.locator('#draft-gender').selectOption(draft.gender);
  await page.locator('#draft-birthday-month').selectOption(String(draft.birthday.month));
  await page.locator('#draft-birthday').selectOption(String(draft.birthday.day));
  await addSpecies(page, draft.species);
  await page.locator('#draft-firstAppearance').fill(String(draft.firstAppearance));
  await page.getByRole('option', { name: `Ch. ${draft.firstAppearance} —` }).click();
  for (const [index, epithet] of draft.epithets.entries()) {
    await addPart(page, 'epithets');
    for (const language of languages) {
      await page
        .locator(`#draft-epithets-${index}-text-${language}`)
        .fill(inLanguage(epithet, language));
    }
  }
  for (const [index, alias] of draft.aliases.entries()) {
    await addPart(page, 'aliases');
    await page.locator(`#draft-aliases-${index}-alias`).fill(alias);
  }
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
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]{36}$/);
}

/**
 * Adds an empty entry to the part list of the field `key`. One at a time: an entry left empty
 * is not kept, so each is filled before the next is added.
 */
async function addPart(page: Page, key: string): Promise<void> {
  await page.getByTestId(`draft-${key}`).getByTestId('part-add').click();
}

/**
 * Picks each species from the relation search, the first two added the other way round and
 * put in order by moving the second entry up.
 */
async function addSpecies(page: Page, names: string[]): Promise<void> {
  const added = names.length > 1 ? [names[1], names[0], ...names.slice(2)] : names;
  for (const [index, name] of added.entries()) {
    await addPart(page, 'species');
    await page.locator(`#draft-species-${index}-species`).fill(name);
    await page.getByRole('option', { name }).click();
  }
  if (names.length > 1) {
    await page.getByTestId('draft-species').getByTestId('part-up').nth(1).click();
  }
}

/** One membership as the content API saves it; `affiliation` is a content id. */
export interface MembershipBody {
  affiliation: string;
  role?: Record<string, string>;
  marineRank?: string;
  former?: boolean;
}

/** The body the content API saves a character with; `chapter`, `species` and affiliations are content ids. */
export function characterBody(
  languages: string[],
  draft: {
    romaji: string;
    name: string;
    chapter: string;
    epithets?: Record<string, string>[];
    aliases?: string[];
    species?: string[];
    affiliations?: MembershipBody[];
  },
): Record<string, unknown> {
  return {
    romaji: draft.romaji,
    status: 'ALIVE',
    gender: 'MALE',
    firstAppearance: { chapter: draft.chapter },
    epithets: (draft.epithets ?? []).map((text) => ({ text })),
    aliases: draft.aliases ?? [],
    species: draft.species ?? [],
    affiliations: draft.affiliations ?? [],
    translations: Object.fromEntries(
      languages.map((code) => [
        code,
        {
          name: `${draft.name} (${code})`,
          description: `${draft.name} described in ${code}.`,
        },
      ]),
    ),
  };
}

/** Saves a character draft through the content API; the response is the caller's to judge. */
export function saveCharacter(page: Page, body: Record<string, unknown>): Promise<APIResponse> {
  return page.request.post('/api/content/characters', { data: body });
}
