import { Browser, expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { blockedActions } from './support/content';
import { bountyBody, chapterIdOf, createBounty, saveBounty } from './support/bounty';
import { characterBody, inLanguage } from './support/character';
import {
  bountyPath,
  characterPath,
  getPublic,
  PublicBounty,
  PublicCharacter,
} from './support/public-api';
import {
  approve,
  Crew,
  createDraft,
  languageCodes,
  onlineChapter,
  publish,
  putOnline,
  reasonOf,
  retire,
} from './support/story';

// The relations of a character, one pair of steps at a time (character plan, C7 and the
// steps that follow). Bounties first: a bounty names its holder in the editor, the character
// shows the bounties that name it - in the editor and in the public API - and cannot be
// retired while they are online. The rules the content API refuses: a holder that is not yet
// approved, and a bounty going online before its holder. Every content is retired at the end.

async function crewOf(browser: Browser): Promise<Crew> {
  return {
    editor: await signIn(browser, 'chopper'),
    reviewer: await signIn(browser, 'zoro'),
    publisher: await signIn(browser, 'vivi'),
  };
}

const AMOUNT = 366_000_000;

test('a bounty names its holder, and the character shows its bounties until they are retired', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  // The local database keeps the contents of earlier runs: these names are this run's own.
  const stamp = Date.now();
  const romaji = `E2E Holder ${stamp}`;
  const name = `E2E Holder Name ${stamp}`;
  const crew = await crewOf(browser);
  const { editor, publisher } = crew;
  const chapter = await onlineChapter(crew);
  const chapterId = await chapterIdOf(editor, chapter);
  const languages = await languageCodes(editor);
  const characterId = await putOnline(
    crew,
    'characters',
    characterBody(languages, { romaji, name, chapter: chapterId }),
  );

  // The editor picks the holder from the search of the characters, and the card says it.
  const posterName = `E2E Poster ${stamp}`;
  await createBounty(editor, {
    posterName,
    amount: AMOUNT,
    firstAppearance: chapter,
    holderLabel: inLanguage(name, 'en'),
  });
  const bountyId = editor.url().split('/').pop()!;
  await expect(editor.getByTestId('card-holder')).toContainText(inLanguage(name, 'en'));
  await approve(crew, 'bounties', bountyId);
  expect((await publish(crew, 'bounties', bountyId)).status()).toBe(200);

  // The public API: the bounty names its holder, the character lists the bounty.
  const bounty: PublicBounty = await (await getPublic(request, bountyPath('en', bountyId))).json();
  expect(bounty.holder).toMatchObject({
    id: characterId,
    name: `${name} (en)`,
  });
  const character: PublicCharacter = await (
    await getPublic(request, characterPath('en', characterId))
  ).json();
  expect(character.bounties.map((held) => [held.id, held.amount, held.validity])).toEqual([
    [bountyId, AMOUNT, 'ACTIVE'],
  ]);

  // The editor's list of bounties shows the holder in its column, and narrows by it.
  await editor.goto(`/content/bounties?holder=${characterId}`);
  const rows = editor.getByTestId('content-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId('relation-cell')).toContainText(`${name} (en)`);

  // The character's list counts the bounty and leads to the list filtered by it; its card
  // lists it.
  await editor.goto(`/content/characters?q=${encodeURIComponent(romaji)}`);
  await expect(editor.getByTestId('count-cell')).toContainText('1');
  await editor.getByTestId('count-cell').getByRole('link').click();
  await expect(editor).toHaveURL(new RegExp(`/content/bounties\\?holder=${characterId}`));
  await expect(rows).toHaveCount(1);
  await editor.goto(`/content/characters/${characterId}`);
  await expect(editor.getByTestId('related-count')).toContainText('1');
  await expect(editor.getByTestId('related-name')).toContainText(posterName);

  // The character cannot be retired while the bounty is online: the card says upfront why,
  // and the refusal names the bounty.
  const blocked = await blockedActions(publisher, `/content/characters/${characterId}`);
  await expect(blocked).toContainText('Bounties are still online');
  const refused = await retire(crew, 'characters', characterId);
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('ONLINE_ITEMS_LINKED');
  expect(JSON.stringify(await refused.json())).toContain('bounties');

  // Once the bounty is retired the character goes, and both leave the public API.
  const bountyGone = await retire(crew, 'bounties', bountyId);
  expect(bountyGone.status(), await bountyGone.text()).toBe(200);
  const characterGone = await retire(crew, 'characters', characterId);
  expect(characterGone.status(), await characterGone.text()).toBe(200);
  expect((await getPublic(request, characterPath('en', characterId))).status()).toBe(404);
});

test('the holder rules refuse a holder that is not approved and a bounty before its holder', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const crew = await crewOf(browser);
  const { editor } = crew;
  const chapterId = await chapterIdOf(editor, await onlineChapter(crew));
  const languages = await languageCodes(editor);
  const bounty = (holder: string, amount: number) =>
    bountyBody(languages, {
      posterName: `E2E Holder Rule ${stamp}`,
      amount,
      chapter: chapterId,
      holder,
    });

  // A character still in draft cannot be a holder: refused on save, naming the field.
  const draftCharacter = await createDraft(
    editor,
    'characters',
    characterBody(languages, {
      romaji: `E2E Draft Holder ${stamp}`,
      name: `E2E Draft Holder Name ${stamp}`,
      chapter: chapterId,
    }),
  );
  const unapproved = await saveBounty(editor, bounty(draftCharacter, 1_000));
  expect(unapproved.status(), await unapproved.text()).toBe(422);
  expect(JSON.stringify(await unapproved.json())).toContain('holder');

  // An approved holder is accepted, but the bounty cannot go online before the holder does.
  await approve(crew, 'characters', draftCharacter);
  const early = await createDraft(editor, 'bounties', bounty(draftCharacter, 2_000));
  await approve(crew, 'bounties', early);
  const notYet = await publish(crew, 'bounties', early);
  expect(notYet.status()).toBe(409);
  expect(await reasonOf(notYet)).toBe('RELATED_NOT_ONLINE');
  expect(JSON.stringify(await notYet.json())).toContain('holder');

  // Holder first, then the bounty: both go online and retire, the bounty first.
  expect((await publish(crew, 'characters', draftCharacter)).status()).toBe(200);
  expect((await publish(crew, 'bounties', early)).status()).toBe(200);
  for (const [entity, id] of [
    ['bounties', early],
    ['characters', draftCharacter],
  ] as const) {
    const response = await retire(crew, entity, id);
    expect(response.status(), await response.text()).toBe(200);
  }
});
