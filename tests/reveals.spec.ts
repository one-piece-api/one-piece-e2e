import { expect, Locator, Page, test } from "@playwright/test";
import { chapterIdOf } from "./support/bounty";
import { signIn } from "./support/crew";
import { fruitTypeBody } from "./support/devil-fruit";
import { paragraphsOf } from "./support/paragraphs";
import {
  approve,
  createDraft,
  Crew,
  freshNumber,
  languageCodes,
  onlineChapter,
  publish,
  putOnline,
  translationsOf,
} from "./support/story";

// Field reveals (reveals plan R4, R8): the reader first believes the fruit is a Paramecia named
// Gomu Gomu; at a later chapter and episode a reveal names its real name and type. Written in
// the editor's Reveals section, shown read-only on the card's tab and in the comparison, kept
// by the content API once online.

/** Picks an online chapter or episode by its number in the story point box `box`. */
async function pickPoint(
  page: Page,
  box: Locator,
  label: string,
  number: number,
) {
  await box.fill(String(number));
  const id = await box.getAttribute("id");
  await page
    .locator(`#${id}-listbox`)
    .getByRole("option", { name: `${label} ${number} —` })
    .click();
}

/** The id of the arc a chapter online belongs to, from its version. */
async function arcOf(page: Page, chapterId: string): Promise<string> {
  const response = await page.request.get(
    `/api/content/chapters/${chapterId}/versions/1`,
  );
  expect(response.ok()).toBeTruthy();
  const arc = (await response.json()).body.arc;
  return typeof arc === "string" ? arc : arc.id;
}

test("a fruit believed to be the Gomu Gomu reveals its real name and type at a chapter and an episode", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const crew: Crew = {
    editor: await signIn(browser, "chopper"),
    reviewer: await signIn(browser, "zoro"),
    publisher: await signIn(browser, "vivi"),
  };
  const { editor } = crew;
  const languages = await languageCodes(editor);

  // Two chapters and two episodes online: the first appearance, then the reveal on both axes.
  const firstChapter = await onlineChapter(crew);
  const revealChapter = await onlineChapter(crew);
  const firstChapterId = await chapterIdOf(editor, firstChapter);
  const arc = await arcOf(editor, firstChapterId);
  const episode = (number: number) =>
    putOnline(crew, "episodes", {
      number,
      arc,
      japaneseTitle: `E2E ${number}`,
      broadcasts: [{ country: "JP", date: "2022-02-02" }],
      translations: translationsOf(languages, `E2E Reveal Episode ${number}`),
    });
  const firstEpisode = freshNumber();
  const revealEpisode = freshNumber();
  const firstEpisodeId = await episode(firstEpisode);
  await episode(revealEpisode);

  // The type the reader believes, and the real one.
  const believedType = `E2E Believed Kind ${stamp}`;
  const realType = `E2E Awakened Kind ${stamp}`;
  const typeIds: string[] = [];
  for (const name of [believedType, realType]) {
    typeIds.push(
      await putOnline(
        crew,
        "devil-fruit-types",
        fruitTypeBody(languages, {
          romaji: `${name}-kei`,
          name,
          chapter: firstChapterId,
        }),
      ),
    );
  }

  // The fruit as it truly is, first appearing at the first chapter and episode.
  const fruitName = `E2E Nika ${stamp}`;
  const at = { chapter: firstChapterId, episode: firstEpisodeId };
  const section = (words: string) =>
    paragraphsOf(languages, (code) => `${fruitName} ${words} in ${code}.`, at);
  const fruitId = await createDraft(editor, "devil-fruits", {
    romaji: `${fruitName} no Mi`,
    type: typeIds[1],
    multipleUsers: false,
    firstAppearance: at,
    description: section("described"),
    advantages: section("advantages"),
    disadvantages: section("disadvantages"),
    translations: Object.fromEntries(
      languages.map((code) => [code, { name: `${fruitName} (${code})` }]),
    ),
  });
  const card = `/content/devil-fruits/${fruitId}`;

  // The editor: a reveal at the later chapter and episode, naming the name and the type.
  await editor.goto(`${card}/edit`);
  await editor.getByTestId("editor-section-reveals").click();
  await editor.getByTestId("add-reveal").click();
  const detail = editor.getByTestId("reveal-detail");
  await pickPoint(
    editor,
    detail.locator('input[id$="-chapter"]'),
    "Ch.",
    revealChapter,
  );
  await pickPoint(
    editor,
    detail.locator('input[id$="-episode"]'),
    "Ep.",
    revealEpisode,
  );
  await expect(editor.getByTestId("reveal-node")).toContainText(
    `Ch. ${revealChapter} · Ep. ${revealEpisode}`,
  );
  const addField = detail.getByTestId("add-field");
  await addField.selectOption("NAME");
  await addField.selectOption("TYPE");
  await expect(detail.getByTestId("reveal-row")).toHaveCount(2);

  const title = (code: string) => `The fruit is Nika (${code})`;
  const believedName = (code: string) => `Gomu Gomu ${stamp} (${code})`;
  const nameRow = detail.getByTestId("reveal-row").nth(0);
  for (const code of languages) {
    // The title box is redrawn for the language: write only once the switch shows it.
    const language = editor.getByTestId(`reveal-language-${code}`);
    await language.click();
    await expect(language).toHaveAttribute("aria-pressed", "true");
    await detail.getByTestId("reveal-title").fill(title(code));
    if (
      (await nameRow
        .getByTestId("reveal-row-toggle")
        .getAttribute("aria-expanded")) !== "true"
    ) {
      await nameRow.getByTestId("reveal-row-toggle").click();
    }
    await nameRow
      .locator(`#reveal-initial-name-${code}`)
      .fill(believedName(code));
  }
  const typeRow = detail.getByTestId("reveal-row").nth(1);
  await typeRow.getByTestId("reveal-row-toggle").click();
  await typeRow.locator("#reveal-initial-type").fill(believedType);
  await editor.getByRole("option", { name: `${believedType} (en)` }).click();
  await expect(typeRow.locator("#reveal-initial-type")).toHaveValue(
    `${believedType} (en)`,
  );

  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(editor).toHaveURL(new RegExp(`${card}(\\?v=1)?$`));

  // The card: a tab of its own, read only, from the believed values to the truth.
  await editor.getByRole("tab", { name: /Reveals/ }).click();
  const panel = editor.getByTestId("reveals-panel");
  await expect(panel.getByTestId("reveal-node")).toHaveCount(1);
  await expect(panel.getByTestId("reveal-node")).toContainText(title("en"));
  await panel.getByTestId("reveal-node").click();
  await expect(panel.getByTestId("reveal-title")).toHaveCount(0);
  await expect(panel.getByTestId("reveal-row")).toHaveCount(2);
  const shownName = panel.getByTestId("reveal-row").nth(0);
  await expect(shownName.getByTestId("reveal-row-before")).toHaveText(
    believedName("en"),
  );
  await expect(shownName.getByTestId("reveal-row-after")).toHaveText(
    `${fruitName} (en)`,
  );

  // The comparison of the first version: the initial knowledge and the reveal, added.
  await editor.getByTestId("compare-versions").click();
  await expect(editor.getByTestId("comparison-reveals-count")).toContainText(
    "2 reveals changed",
  );
  await expect(editor.getByTestId("comparison-reveal-heading")).toHaveText(
    `Reveal 1 · ${title("en")}`,
  );
  await expect(
    editor
      .getByTestId("comparison-reveal-row")
      .filter({ hasText: "Initial knowledge · Name EN" }),
  ).toContainText(believedName("en"));

  // Online, the content API keeps the initial knowledge and the reveal.
  await approve(crew, "devil-fruits", fruitId);
  const published = await publish(crew, "devil-fruits", fruitId);
  expect(published.status(), await published.text()).toBe(200);
  const saved = await editor.request.get(
    `/api/content/devil-fruits/${fruitId}/versions/1`,
  );
  const body = (await saved.json()).body;
  expect(body.initialKnowledge.translations.en.name).toBe(believedName("en"));
  expect(body.initialKnowledge.type.id).toBe(typeIds[0]);
  expect(body.reveals).toHaveLength(1);
  expect(body.reveals[0].fields).toEqual(["NAME", "TYPE"]);
  expect(body.reveals[0].titles.en).toBe(title("en"));
  expect(body.reveals[0].revealedAt.chapter.number).toBe(revealChapter);
  expect(body.reveals[0].revealedAt.episode.number).toBe(revealEpisode);
});
