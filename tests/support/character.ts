import { APIResponse, expect, Page } from "@playwright/test";
import { characterImage, UploadFile } from "./images";
import {
  addParagraph,
  inEachLanguage,
  paragraphsOf,
  pickChapter,
} from "./paragraphs";
import { ContentBody, contentRequest, UPLOADS } from "./story";

export { pickChapter };

/** What a character draft is written with, through the editor. */
export interface CharacterDraft {
  romaji: string;
  /** The name; every language gets its own code appended. */
  name: string;
  japaneseName: string;
  status: "ALIVE" | "DECEASED" | "UNKNOWN";
  gender: "MALE" | "FEMALE" | "UNKNOWN";
  birthday: { day: number; month: number };
  /** The number of the online chapter that is its first appearance. */
  firstAppearance: number;
  /** The images of its gallery, in order: at least an appearance, as review asks. */
  gallery: GalleryDraft[];
  /** The base text of each epithet, in order; every language gets its own code appended. */
  epithets: string[];
  aliases: string[];
  /** The names of the online species, in the order the character shows them. */
  species: string[];
}

/** The kind of a gallery image: an appearance or a form (workflow 3.5.1). */
export type GalleryKind = "ASPETTO" | "FORMA";

/**
 * One image of a gallery, through the editor: discovered at the first appearance, ended there
 * too when `ended` is set; its caption gets every language's code appended.
 */
export interface GalleryDraft {
  image: UploadFile;
  kind: GalleryKind;
  caption: string;
  ended?: boolean;
}

/** The text an epithet or a name is written with in one language. */
export function inLanguage(text: string, language: string): string {
  return `${text} (${language})`;
}

/**
 * Writes a complete character draft in the editor - romaji, Japanese name, gallery, status,
 * gender, birthday, first appearance, the species picked from the search, epithets in every
 * language, aliases, a name in every language and a paragraph of description - and saves it. Every entry
 * is discovered at the first appearance: review asks for it, and its pickers keep to the axes
 * of the first appearance, so that comes first. The two first species are added swapped and
 * put right with the entry's "up" button, so the order is the editor's own. Leaves the page
 * on the new content's card.
 */
export async function createCharacter(
  page: Page,
  draft: CharacterDraft,
): Promise<void> {
  await page.goto("/content/characters/new");
  await page.getByLabel("Romaji").fill(draft.romaji);
  await page.locator("#draft-japaneseName").fill(draft.japaneseName);
  await page.locator("#draft-status").selectOption(draft.status);
  await page.locator("#draft-gender").selectOption(draft.gender);
  await page
    .locator("#draft-birthday-month")
    .selectOption(String(draft.birthday.month));
  await page
    .locator("#draft-birthday")
    .selectOption(String(draft.birthday.day));
  await pickChapter(page, "draft-firstAppearance", draft.firstAppearance);
  await addSpecies(page, draft.species, draft.firstAppearance);
  for (const [index, epithet] of draft.epithets.entries()) {
    await addPart(page, "epithets");
    await inEachLanguage(page, "epithets", (language) =>
      page
        .locator(`#draft-epithets-${index}-text-${language}`)
        .fill(inLanguage(epithet, language)),
    );
    await pickChapter(
      page,
      `draft-epithets-${index}-discovered`,
      draft.firstAppearance,
    );
  }
  for (const [index, alias] of draft.aliases.entries()) {
    await addPart(page, "aliases");
    await page.locator(`#draft-aliases-${index}-alias`).fill(alias);
    await pickChapter(
      page,
      `draft-aliases-${index}-discovered`,
      draft.firstAppearance,
    );
  }
  for (const [index, entry] of draft.gallery.entries()) {
    await addGalleryImage(page, index, entry, draft.firstAppearance);
  }
  await addParagraph(
    page,
    "description",
    (language) => `${draft.name} described in ${language}.`,
    draft.firstAppearance,
  );
  const tabs = page.getByRole("tab");
  for (let index = 0; index < (await tabs.count()); index++) {
    const tab = tabs.nth(index);
    await tab.click();
    const language = await tab.getAttribute("title");
    await page.locator("#draft-name").fill(`${draft.name} (${language})`);
  }
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/New draft aboard/)).toBeVisible();
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]{36}$/);
}

/**
 * Adds image `index` at the end of the gallery: the file, its kind, its caption in every
 * language, discovered at this chapter and, when the draft says so, ended there too.
 */
export async function addGalleryImage(
  page: Page,
  index: number,
  entry: GalleryDraft,
  chapter: number,
): Promise<void> {
  await addPart(page, "gallery");
  const gallery = page.getByTestId("draft-gallery");
  await page
    .locator(`#draft-gallery-${index}-image`)
    .setInputFiles(entry.image);
  await expect(gallery.getByTestId("image-preview").nth(index)).toBeVisible();
  await page.locator(`#draft-gallery-${index}-kind`).selectOption(entry.kind);
  await inEachLanguage(page, "gallery", (language) =>
    page
      .locator(`#draft-gallery-${index}-caption-${language}`)
      .fill(inLanguage(entry.caption, language)),
  );
  await pickChapter(page, `draft-gallery-${index}-discovered`, chapter);
  if (entry.ended) {
    await gallery
      .getByTestId("part-entry")
      .nth(index)
      .getByTestId("window-add-end")
      .click();
    await pickChapter(page, `draft-gallery-${index}-ended`, chapter);
  }
}

/**
 * Adds an empty entry to the part list of the field `key`. One at a time: an entry left empty
 * is not kept, so each is filled before the next is added.
 */
async function addPart(page: Page, key: string): Promise<void> {
  await page.getByTestId(`draft-${key}`).getByTestId("part-add").click();
}

/**
 * Picks each species from the relation search, discovered at this chapter, the first two added
 * the other way round and put in order by moving the second entry up.
 */
async function addSpecies(
  page: Page,
  names: string[],
  chapter: number,
): Promise<void> {
  const added =
    names.length > 1 ? [names[1], names[0], ...names.slice(2)] : names;
  for (const [index, name] of added.entries()) {
    await addPart(page, "species");
    await page.locator(`#draft-species-${index}-species`).fill(name);
    await page.getByRole("option", { name }).click();
    await pickChapter(page, `draft-species-${index}-discovered`, chapter);
  }
  if (names.length > 1) {
    await page
      .getByTestId("draft-species")
      .getByTestId("part-up")
      .nth(1)
      .click();
  }
}

/** A point of the reader axis as the content API saves it: content ids. */
export interface StoryPointBody {
  chapter?: string;
  episode?: string;
}

/** One stay in an affiliation: its role, its rank in the Navy, and its window. */
export interface PeriodBody {
  role?: Record<string, string>;
  marineRank?: string;
  discovered: StoryPointBody;
  ended?: StoryPointBody;
}

/** One membership as the content API saves it; `affiliation` is a content id. */
export interface MembershipBody {
  affiliation: string;
  periods: PeriodBody[];
}

/**
 * One Devil Fruit of a character as the content API saves it; `devilFruit` is a content id.
 * Its window is discovered at the first appearance unless given; an end makes the user former.
 */
export interface FruitUseBody {
  devilFruit: string;
  discovered?: StoryPointBody;
  ended?: StoryPointBody;
}

/** One relative of a character as the content API saves it; `relative` is a content id. */
export interface RelativeBody {
  relative: string;
  kind: string;
  discovered?: StoryPointBody;
}

/** One image of a gallery as the content API saves it, the file uploaded with the body. */
export interface GalleryImageBody {
  image: UploadFile;
  kind: GalleryKind;
  caption?: string;
  ended?: StoryPointBody;
}

/**
 * The body the content API saves a character with; `chapter`, `species` and affiliations are
 * content ids. Every entry of a list is discovered at the first appearance unless it says
 * otherwise; a membership's periods are given whole. The gallery is one appearance unless
 * given: each image is uploaded with the body (`upload: n`), its caption in every language.
 */
export function characterBody(
  languages: string[],
  draft: {
    romaji: string;
    name: string;
    chapter: string;
    /** The first appearance on the episode axis too, when the character is read there. */
    episode?: string;
    epithets?: Record<string, string>[];
    aliases?: string[];
    species?: string[];
    affiliations?: MembershipBody[];
    devilFruits?: FruitUseBody[];
    relatives?: RelativeBody[];
    gender?: "MALE" | "FEMALE" | "UNKNOWN";
    gallery?: GalleryImageBody[];
  },
): ContentBody {
  const discovered: StoryPointBody = draft.episode
    ? { chapter: draft.chapter, episode: draft.episode }
    : { chapter: draft.chapter };
  const gallery = draft.gallery ?? [
    { image: characterImage(), kind: "ASPETTO" },
  ];
  return {
    [UPLOADS]: gallery.map(({ image }) => image),
    gallery: gallery.map(({ kind, caption, ended }, upload) => ({
      upload,
      kind,
      caption: Object.fromEntries(
        languages.map((code) => [
          code,
          inLanguage(caption ?? `${draft.name} portrait`, code),
        ]),
      ),
      discovered,
      ended: ended ?? null,
    })),
    romaji: draft.romaji,
    status: "ALIVE",
    gender: draft.gender ?? "MALE",
    firstAppearance: discovered,
    epithets: (draft.epithets ?? []).map((text) => ({ text, discovered })),
    aliases: (draft.aliases ?? []).map((alias) => ({ alias, discovered })),
    species: (draft.species ?? []).map((species) => ({ species, discovered })),
    affiliations: draft.affiliations ?? [],
    devilFruits: (draft.devilFruits ?? []).map((use) => ({
      discovered,
      ...use,
    })),
    relatives: (draft.relatives ?? []).map((relative) => ({
      discovered,
      ...relative,
    })),
    description: paragraphsOf(
      languages,
      (code) => `${draft.name} described in ${code}.`,
      discovered,
    ),
    translations: Object.fromEntries(
      languages.map((code) => [code, { name: `${draft.name} (${code})` }]),
    ),
  };
}

/** Saves a character draft through the content API; the response is the caller's to judge. */
export function saveCharacter(
  page: Page,
  body: ContentBody,
): Promise<APIResponse> {
  return page.request.post("/api/content/characters", contentRequest(body));
}
