import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { putGomuGomuOnline } from './support/gomu-gomu';

// The preview of a version as the reader sees it (reveals plan R9, R10; UF-CNT-23): the Gomu
// Gomu of the reference case, read in the back-office at a chapter and at an episode. The
// position lives in the URL, the card is the backend's preview of the version, and the editor
// never has to publish to see what the reader will know.

test('the preview shows the card as the reader sees it at a chapter and at an episode', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const crew = {
    editor: await signIn(browser, 'chopper'),
    reviewer: await signIn(browser, 'zoro'),
    publisher: await signIn(browser, 'vivi'),
  };
  const gomu = await putGomuGomuOnline(crew);
  const { editor } = crew;
  const preview = editor.getByTestId('reader-preview');
  const number = editor.getByTestId('preview-number');

  // Nothing is asked until a position is chosen.
  await editor.goto(`/content/devil-fruits/${gomu.fruit}`);
  await editor.getByRole('tab', { name: /Reader preview/ }).click();
  await expect(editor.getByTestId('preview-idle')).toBeVisible();

  // The day before the reveal, on the chapter axis: the Gomu Gomu, a Paramecia.
  await number.fill(String(gomu.chapter.before));
  await number.press('Enter');
  await expect(preview).toContainText(gomu.believedName);
  await expect(preview).toContainText(gomu.parameciaName);
  await expect(preview).not.toContainText(gomu.trueName);
  await expect(editor).toHaveURL(new RegExp(`axis=chapter&n=${gomu.chapter.before}`));

  // The reveal: the real name and the Zoan.
  await number.fill(String(gomu.chapter.reveal));
  await number.press('Enter');
  await expect(preview).toContainText(gomu.trueName);
  await expect(preview).toContainText(gomu.zoanName);
  await expect(preview).not.toContainText(gomu.believedName);

  // Before the first appearance the reader has not met the fruit: a word, not an empty card.
  await number.fill(String(gomu.chapter.first - 1));
  await number.press('Enter');
  await expect(editor.getByTestId('preview-not-visible')).toBeVisible();

  // The episode axis is read on its own, with its own numbers.
  // The switch asks again with the number typed so far; type the next one once it is answered.
  await Promise.all([
    editor.waitForResponse((response) => response.url().includes('asOfEpisode=')),
    editor.getByTestId('preview-axis-episode').click(),
  ]);
  await number.fill(String(gomu.episode.before));
  await number.press('Enter');
  await expect(preview).toContainText(gomu.believedName);
  await number.fill(String(gomu.episode.reveal));
  await number.press('Enter');
  await expect(preview).toContainText(gomu.trueName);

  // The position is in the link: opening it again shows the same reader.
  await editor.reload();
  await expect(editor).toHaveURL(new RegExp(`axis=episode&n=${gomu.episode.reveal}`));
  await expect(editor.getByTestId('reader-preview')).toContainText(gomu.trueName);

  // A number that is not whole is refused, and asks nothing.
  await number.fill('1.5');
  await number.press('Enter');
  await expect(editor.getByTestId('preview-number-refused')).toBeVisible();
  await expect(editor).toHaveURL(new RegExp(`n=${gomu.episode.reveal}`));
});
