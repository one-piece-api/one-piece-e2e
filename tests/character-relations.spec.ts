import { Browser, expect, Page, test } from '@playwright/test';
import { signIn } from './support/crew';
import { blockedActions } from './support/content';
import { bountyBody, chapterIdOf, createBounty, saveBounty } from './support/bounty';
import { affiliationBody } from './support/affiliation';
import { devilFruitBody, fruitTypeBody } from './support/devil-fruit';
import { characterBody, FruitUseBody, inLanguage } from './support/character';
import {
  bountyPath,
  characterPath,
  devilFruitPath,
  getPublic,
  PublicBounty,
  PublicCharacter,
  PublicCharacterSummary,
  PublicDevilFruitDetail,
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
// approved, and a bounty going online before its holder. Then the memberships (C9): written in
// the editor with a role in every language and a rank only in the Navy, read in the public API
// and its filters, and the rules the API refuses - a rank outside the Navy, an affiliation
// leaving the Navy while a ranked character is online. Every content is retired at the end.

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

/** Opens a new draft of the closed version `basedOn` of an affiliation, as the caller. */
async function openNewAffiliationVersion(page: Page, id: string, basedOn: number): Promise<void> {
  const response = await page.request.post(`/api/content/affiliations/${id}/versions`, {
    data: { basedOn },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test('a character belongs to a crew and to the Navy with a role and a rank, in the editor and the public API', async ({
  browser,
  request,
}) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const crew = await crewOf(browser);
  const { editor, publisher } = crew;
  const chapter = await onlineChapter(crew);
  const chapterId = await chapterIdOf(editor, chapter);
  const languages = await languageCodes(editor);
  const crewName = `E2E Crew ${stamp}`;
  const navyName = `E2E Navy ${stamp}`;
  const crewId = await putOnline(
    crew,
    'affiliations',
    affiliationBody(languages, {
      romaji: `E2E Crew Romaji ${stamp}`,
      kind: 'PIRATE_CREW',
      name: crewName,
      chapter: chapterId,
    }),
  );
  const navyId = await putOnline(
    crew,
    'affiliations',
    affiliationBody(languages, {
      romaji: `E2E Navy Romaji ${stamp}`,
      kind: 'NAVY',
      name: navyName,
      chapter: chapterId,
    }),
  );

  // The editor writes the memberships: a role in every language, and the rank only once the
  // affiliation picked is the Navy.
  const romaji = `E2E Member ${stamp}`;
  await editor.goto('/content/characters/new');
  await editor.getByLabel('Romaji').fill(romaji);
  await editor.locator('#draft-status').selectOption('ALIVE');
  await editor.locator('#draft-gender').selectOption('MALE');
  await editor.locator('#draft-firstAppearance').fill(String(chapter));
  await editor.getByRole('option', { name: `Ch. ${chapter} —` }).click();
  const memberships = editor.getByTestId('draft-affiliations');
  const pick = async (index: number, label: string, role: string) => {
    await memberships.getByTestId('part-add').click();
    await editor.locator(`#draft-affiliations-${index}-affiliation`).fill(label);
    await editor.getByRole('option', { name: label }).click();
    await memberships.getByTestId('part-entry').nth(index).getByTestId('relation-clear').waitFor();
    for (const language of languages) {
      await editor
        .locator(`#draft-affiliations-${index}-role-${language}`)
        .fill(inLanguage(role, language));
    }
  };
  await pick(0, inLanguage(crewName, 'en'), 'Captain');
  await expect(editor.locator('#draft-affiliations-0-marineRank')).toHaveCount(0);
  await pick(1, inLanguage(navyName, 'en'), 'Spy');
  await editor.locator('#draft-affiliations-1-marineRank').selectOption('VICE_ADMIRAL');
  const tabs = editor.getByRole('tab');
  for (let index = 0; index < (await tabs.count()); index++) {
    const tab = tabs.nth(index);
    await tab.click();
    const language = await tab.getAttribute('title');
    await editor.locator('#draft-name').fill(`${romaji} (${language})`);
    await editor.locator('#draft-description').fill(`${romaji} described in ${language}.`);
  }
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByText(/New draft aboard/)).toBeVisible();
  await expect(editor).toHaveURL(/\/characters\/[0-9a-f-]{36}$/);
  const characterId = editor.url().split('/').pop()!;
  const card = editor.getByTestId('card-affiliations');
  await expect(card).toContainText(inLanguage(crewName, 'en'));
  await expect(card).toContainText('Vice Admiral');
  await approve(crew, 'characters', characterId);
  expect((await publish(crew, 'characters', characterId)).status()).toBe(200);

  // The public API: both memberships in order, the role in the reader's language, the rank.
  const character: PublicCharacter = await (
    await getPublic(request, characterPath('en', characterId))
  ).json();
  expect(
    character.affiliations.map(({ affiliation, role, marineRank, former }) => [
      affiliation.id,
      affiliation.kind,
      role,
      marineRank,
      former,
    ]),
  ).toEqual([
    [crewId, 'PIRATE_CREW', inLanguage('Captain', 'en'), null, false],
    [navyId, 'NAVY', inLanguage('Spy', 'en'), 'VICE_ADMIRAL', false],
  ]);

  // The public list finds the character by either affiliation and by the kind of its groups.
  const listed = async (query: string) => {
    const page: { content: PublicCharacterSummary[] } = await (
      await getPublic(request, `${characterPath('en')}?${query}`)
    ).json();
    return page.content.map(({ id }) => id);
  };
  expect(await listed(`affiliation=${crewId}`)).toEqual([characterId]);
  expect(await listed(`affiliation=${navyId}`)).toEqual([characterId]);
  expect(await listed(`affiliationKind=NAVY&q=${encodeURIComponent(romaji)}`)).toEqual([
    characterId,
  ]);
  expect(
    await listed(`affiliationKind=REVOLUTIONARY_ARMY&q=${encodeURIComponent(romaji)}`),
  ).toEqual([]);

  // The editor's list narrows by the affiliation, and the affiliation counts its members and
  // leads to that list.
  await editor.goto(`/content/characters?affiliation=${crewId}`);
  await expect(editor.getByTestId('content-row')).toHaveCount(1);
  await editor.goto(`/content/affiliations?q=${encodeURIComponent(crewName)}`);
  await expect(editor.getByTestId('count-cell')).toContainText('1');
  await editor.getByTestId('count-cell').getByRole('link').click();
  await expect(editor).toHaveURL(new RegExp(`/content/characters\\?affiliation=${crewId}`));

  // The affiliation cannot be retired while the character names it; the refusal says so.
  const blocked = await blockedActions(publisher, `/content/affiliations/${crewId}`);
  await expect(blocked).toContainText('Online characters are still linked');
  const refused = await retire(crew, 'affiliations', crewId);
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('ONLINE_ITEMS_LINKED');

  for (const [entity, id] of [
    ['characters', characterId],
    ['affiliations', crewId],
    ['affiliations', navyId],
  ] as const) {
    const response = await retire(crew, entity, id);
    expect(response.status(), await response.text()).toBe(200);
  }
});

test('the rank rules refuse a rank outside the Navy and an affiliation leaving the Navy while ranked', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const crew = await crewOf(browser);
  const { editor } = crew;
  const chapterId = await chapterIdOf(editor, await onlineChapter(crew));
  const languages = await languageCodes(editor);
  const affiliation = (kind: string, label: string) =>
    putOnline(
      crew,
      'affiliations',
      affiliationBody(languages, {
        romaji: `E2E ${label} Romaji ${stamp}`,
        kind,
        name: `E2E ${label} ${stamp}`,
        chapter: chapterId,
      }),
    );
  const navyId = await affiliation('NAVY', 'Rank Navy');
  const crewId = await affiliation('PIRATE_CREW', 'Rank Crew');
  const character = (romaji: string, affiliationId: string) =>
    characterBody(languages, {
      romaji,
      name: `${romaji} name`,
      chapter: chapterId,
      affiliations: [{ affiliation: affiliationId, marineRank: 'ADMIRAL' }],
    });

  // A rank in a pirate crew is refused on save, naming the membership's rank.
  const outside = await editor.request.post('/api/content/characters', {
    data: character(`E2E Rank Outside ${stamp}`, crewId),
  });
  expect(outside.status()).toBe(422);
  expect(JSON.stringify(await outside.json())).toContain('affiliations[0].marineRank');

  // In the Navy it is accepted and goes online.
  const characterId = await putOnline(
    crew,
    'characters',
    character(`E2E Rank Inside ${stamp}`, navyId),
  );

  // The Navy cannot go online as anything else while a ranked character is online.
  await openNewAffiliationVersion(editor, navyId, 1);
  const other = await editor.request.put(`/api/content/affiliations/${navyId}/versions/2`, {
    data: affiliationBody(languages, {
      romaji: `E2E Rank Navy Romaji ${stamp}`,
      kind: 'OTHER',
      name: `E2E Rank Navy ${stamp}`,
      chapter: chapterId,
    }),
  });
  expect(other.status(), await other.text()).toBeLessThan(300);
  await approve(crew, 'affiliations', navyId, 2);
  const refused = await publish(crew, 'affiliations', navyId, 2);
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('MARINE_RANK_IN_USE');
  expect(JSON.stringify(await refused.json())).toContain('characters');

  for (const [entity, id] of [
    ['characters', characterId],
    ['affiliations', navyId],
    ['affiliations', crewId],
  ] as const) {
    const response = await retire(crew, entity, id);
    expect(response.status(), await response.text()).toBe(200);
  }
});

test('a Devil Fruit has one current user, unless it is shared, in the editor and the public API', async ({
  browser,
  request,
}) => {
  test.setTimeout(360_000);
  const stamp = Date.now();
  const crew = await crewOf(browser);
  const { editor, publisher } = crew;
  const chapterId = await chapterIdOf(editor, await onlineChapter(crew));
  const languages = await languageCodes(editor);
  const typeId = await putOnline(
    crew,
    'devil-fruit-types',
    fruitTypeBody(languages, {
      romaji: `E2E Fruit Type ${stamp}`,
      name: `E2E Fruit Type ${stamp}`,
      chapter: chapterId,
    }),
  );
  const fruit = (label: string, multipleUsers = false) =>
    putOnline(
      crew,
      'devil-fruits',
      devilFruitBody(languages, {
        romaji: `E2E ${label} Fruit ${stamp}`,
        name: `E2E ${label} Fruit ${stamp}`,
        type: typeId,
        chapter: chapterId,
        multipleUsers,
      }),
    );
  const meraId = await fruit('Mera');
  const smileId = await fruit('Smile', true);
  const character = (label: string, devilFruits: FruitUseBody[]) =>
    characterBody(languages, {
      romaji: `E2E ${label} ${stamp}`,
      name: `E2E ${label} ${stamp}`,
      chapter: chapterId,
      devilFruits,
    });

  // Ace has the fruit now: he goes online, and the second current user is refused.
  const aceId = await putOnline(crew, 'characters', character('Ace', [{ devilFruit: meraId }]));
  const saboId = await createDraft(
    editor,
    'characters',
    character('Sabo', [{ devilFruit: meraId }]),
  );
  await approve(crew, 'characters', saboId);
  const refused = await publish(crew, 'characters', saboId);
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('DEVIL_FRUIT_IN_USE');
  expect(JSON.stringify(await refused.json())).toContain(`E2E Mera Fruit ${stamp}`);
  // The card says so before the publisher tries.
  await expect(await blockedActions(publisher, `/content/characters/${saboId}`)).toContainText(
    'already has a current user',
  );

  // Ace's new version marks him a former user, and then Sabo goes online.
  const reopened = await editor.request.post(`/api/content/characters/${aceId}/versions`, {
    data: { basedOn: 1 },
  });
  expect(reopened.status(), await reopened.text()).toBe(201);
  const updated = await editor.request.put(`/api/content/characters/${aceId}/versions/2`, {
    data: character('Ace', [{ devilFruit: meraId, former: true }]),
  });
  expect(updated.status(), await updated.text()).toBeLessThan(300);
  await approve(crew, 'characters', aceId, 2);
  expect((await publish(crew, 'characters', aceId, 2)).status()).toBe(200);
  expect((await publish(crew, 'characters', saboId)).status()).toBe(200);

  // The public API: the fruit lists its users, the current one first, and the character its fruit.
  const mera: PublicDevilFruitDetail = await (
    await getPublic(request, devilFruitPath('en', meraId))
  ).json();
  expect(mera.multipleUsers).toBe(false);
  expect(mera.users.map(({ character: user, former }) => [user.id, former])).toEqual([
    [saboId, false],
    [aceId, true],
  ]);
  const sabo: PublicCharacter = await (
    await getPublic(request, characterPath('en', saboId))
  ).json();
  expect(sabo.devilFruits.map(({ devilFruit, former }) => [devilFruit.id, former])).toEqual([
    [meraId, false],
  ]);
  const users = await (
    await getPublic(request, `${characterPath('en')}?devilFruit=${meraId}`)
  ).json();
  // Ace lost the power of the fruit: only Sabo has it now.
  expect((users.content as PublicCharacterSummary[]).map(({ id }) => id)).toEqual([saboId]);

  // The editor: the fruit's card lists its current user only, and leads to the characters
  // that have it.
  await editor.goto(`/content/devil-fruits/${meraId}`);
  await expect(editor.getByTestId('related-count')).toContainText('1');
  await expect(editor.getByTestId('related-name')).toContainText(`E2E Sabo ${stamp}`);
  await editor.getByTestId('related-all').click();
  await expect(editor).toHaveURL(new RegExp(`/content/characters\\?devilFruit=${meraId}`));

  // The fruit cannot be retired while its users are online.
  const stuck = await retire(crew, 'devil-fruits', meraId);
  expect(stuck.status()).toBe(409);
  expect(await reasonOf(stuck)).toBe('ONLINE_ITEMS_LINKED');

  // A shared fruit takes two current users.
  const robinId = await putOnline(
    crew,
    'characters',
    character('Caesar', [{ devilFruit: smileId }]),
  );
  const wanzeId = await putOnline(
    crew,
    'characters',
    character('Wanze', [{ devilFruit: smileId }]),
  );
  const smile: PublicDevilFruitDetail = await (
    await getPublic(request, devilFruitPath('en', smileId))
  ).json();
  expect(smile.multipleUsers).toBe(true);
  expect(smile.users.map(({ character: user, former }) => [user.id, former]).sort()).toEqual(
    [
      [robinId, false],
      [wanzeId, false],
    ].sort(),
  );

  // Ace is on his second version.
  for (const [entity, id, version] of [
    ['characters', aceId, 2],
    ['characters', saboId, 1],
    ['characters', robinId, 1],
    ['characters', wanzeId, 1],
    ['devil-fruits', meraId, 1],
    ['devil-fruits', smileId, 1],
    ['devil-fruit-types', typeId, 1],
  ] as const) {
    const response = await retire(crew, entity, id, version);
    expect(response.status(), await response.text()).toBe(200);
  }
});
