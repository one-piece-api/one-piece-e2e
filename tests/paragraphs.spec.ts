import { expect, test } from '@playwright/test';
import { chapterIdOf, contentIdOf } from './support/bounty';
import { signIn } from './support/crew';
import { englishName } from './support/content';
import { fruitTypeBody } from './support/devil-fruit';
import { fruitImage } from './support/images';
import { addParagraph, pickChapter } from './support/paragraphs';
import { devilFruitPath, getPublic, PublicDevilFruitDetail, textsOf } from './support/public-api';
import {
  approve,
  Crew,
  languageCodes,
  onlineChapter,
  publish,
  putOnline,
} from './support/story';

// Long texts as paragraphs (reveals plan R3, R8): a Devil Fruit written in the editor. Review
// asks each section for a paragraph discovered at the first appearance; a paragraph given an
// end is shown as superseded on the card; online, the public API reads the paragraphs.

test('a fruit is described in paragraphs, one per section at its first appearance, an ended one superseded', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const typeName = `E2E Paragraph Kind ${stamp}`;
  const fruitName = `E2E Paragraph Fruit ${stamp}`;
  const crew: Crew = {
    editor: await signIn(browser, 'chopper'),
    reviewer: await signIn(browser, 'zoro'),
    publisher: await signIn(browser, 'vivi'),
  };
  const { editor } = crew;
  const chapter = await onlineChapter(crew);
  const languages = await languageCodes(editor);
  await putOnline(
    crew,
    'devil-fruit-types',
    fruitTypeBody(languages, {
      romaji: `${typeName}-kei`,
      name: typeName,
      chapter: await chapterIdOf(editor, chapter),
    }),
  );

  // A fruit with a description only: the checklist still asks the other two sections.
  await editor.goto('/content/devil-fruits/new');
  await editor.getByLabel('Romaji').fill(`${fruitName} no Mi`);
  await editor.locator('#draft-image').setInputFiles(fruitImage());
  await expect(editor.getByTestId('image-preview')).toBeVisible();
  await editor.locator('#draft-type').fill(typeName);
  await editor.getByRole('option', { name: `${typeName} (en)` }).click();
  await pickChapter(editor, 'draft-firstAppearance', chapter);
  const tabs = editor.getByRole('tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    const tab = tabs.nth(index);
    await tab.click();
    await editor.locator('#draft-name').fill(`${fruitName} (${await tab.getAttribute('title')})`);
  }
  const believed = (language: string) => `Believed a myth, in ${language}.`;
  const known = (language: string) => `Turns its user into fire, in ${language}.`;
  await addParagraph(editor, 'description', known, chapter);
  // A regex, so the match keeps case: a plain string would find "Advantages" in "Disadvantages".
  const section = (name: string) =>
    editor
      .getByTestId('ready-check')
      .filter({ hasText: new RegExp(`${name} · a paragraph discovered at the first appearance`) });
  await expect(section('Description')).toContainText('complete');
  await expect(section('Advantages')).toContainText('required');
  await expect(section('Disadvantages')).toContainText('required');

  // A belief the reader will see disproved: a paragraph of its own, given an end.
  await addParagraph(editor, 'description', believed, chapter);
  await editor
    .getByTestId('draft-description')
    .getByTestId('window-add-end')
    .nth(1)
    .click();
  await pickChapter(editor, 'draft-description-1-ended', chapter);
  await addParagraph(editor, 'advantages', (language) => `Intangible, in ${language}.`, chapter);
  await addParagraph(editor, 'disadvantages', (language) => `Sea water, in ${language}.`, chapter);
  await expect(section('Advantages')).toContainText('complete');
  await expect(section('Disadvantages')).toContainText('complete');
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByText(/New draft aboard/)).toBeVisible();
  await expect(editor).toHaveURL(/\/devil-fruits\/[0-9a-f-]{36}$/);

  // The card shows every paragraph in order; the ended one muted, marked superseded.
  const paragraphs = editor.getByTestId('card-description').getByTestId('card-paragraph');
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.nth(0)).not.toContainText('Superseded');
  await expect(paragraphs.nth(1).getByTestId('card-paragraph-superseded')).toHaveText(
    'Superseded',
  );
  await expect(paragraphs.nth(1).getByTestId('card-paragraph-window')).toContainText(
    `Ended: Ch. ${chapter}`,
  );

  // Online, the public API reads the paragraphs.
  const fruitId = contentIdOf(editor);
  await approve(crew, 'devil-fruits', fruitId);
  const published = await publish(crew, 'devil-fruits', fruitId);
  expect(published.status(), await published.text()).toBe(200);
  const fruit: PublicDevilFruitDetail = await (
    await getPublic(request, devilFruitPath('en', fruitId))
  ).json();
  expect(fruit.name).toBe(englishName(fruitName));
  // The ended paragraph is not served: the reader would read a superseded belief.
  expect(textsOf(fruit.description)).toEqual([known('English')]);
  expect(fruit.description[0].discovered).toEqual({ chapter, episode: null });
});
