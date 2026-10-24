import { Browser, expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { actOnRoute, blockedActions, claimReview, confirm, denDenMushi } from './support/content';
import {
  berryText,
  bountyBody,
  bountyLabel,
  bountyValidity,
  chapterIdOf,
  contentIdOf,
  createBounty,
  draftBounty,
  openNewVersion,
  saveBounty,
} from './support/bounty';
import { posterImage, PUBLIC_IMAGE_PATH } from './support/images';
import { bountyPath, getPublic, PublicBounty, PublicBountyLink } from './support/public-api';
import {
  approve,
  Crew,
  languageCodes,
  onlineChapter,
  publish,
  putOnline,
  reasonOf,
  retire,
} from './support/story';

// The bounty through the whole loop (bounty plan, step B5). The first test follows the
// editors' way in the interface - a poster with its image, a second poster that replaces
// the first, a flag that withdraws it - and reads the result from the public API: validity,
// chain, list, filters and order. The second one works through the content API with real
// sessions and checks the rules that keep the chain consistent: one successor, no cycle,
// nothing online before its previous bounty. Every bounty is retired at the end (an online
// content cannot be deleted), newest first.

const FIRST_AMOUNT = 1_500_000_000;
const SECOND_AMOUNT = 3_000_000_000;

async function crewOf(browser: Browser): Promise<Crew> {
  return {
    editor: await signIn(browser, 'chopper'),
    reviewer: await signIn(browser, 'zoro'),
    publisher: await signIn(browser, 'vivi'),
  };
}

test('a bounty replaces another, is withdrawn, and the list, filters and public API follow', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  // The local database keeps the bounties of earlier runs: this poster name is this run's own.
  const posterName = `E2E Straw ${Date.now()}`;
  const crew = await crewOf(browser);
  const { editor, reviewer, publisher } = crew;
  const chapter = await onlineChapter(crew);

  // The first poster, with its image, through the whole editorial route from its card.
  await createBounty(editor, {
    posterName,
    amount: FIRST_AMOUNT,
    firstAppearance: chapter,
    image: posterImage(),
  });
  const firstCard = editor.url();
  const firstId = contentIdOf(editor);
  await expect(editor.getByTestId('card-name')).toHaveText(bountyLabel(posterName, FIRST_AMOUNT));
  await expect(editor.getByTestId('card-validity')).toHaveText('Active');
  await expect(editor.getByTestId('card-condition')).toHaveText('Dead or alive');
  await actOnRoute(editor, 'Submit for review');
  await expect(denDenMushi(editor)).toContainText('Submitted for review');
  await reviewer.goto(firstCard);
  await claimReview(reviewer);
  await expect(denDenMushi(reviewer)).toContainText('Claimed');
  await actOnRoute(reviewer, 'Approve');
  await expect(denDenMushi(reviewer)).toContainText('Approved');
  await publisher.goto(firstCard);
  await actOnRoute(publisher, 'Publish');
  await confirm(publisher);
  await expect(denDenMushi(publisher)).toContainText('v1 is online');

  // The second poster names the first as the one it replaces, picked from the search.
  await createBounty(editor, {
    posterName,
    amount: SECOND_AMOUNT,
    firstAppearance: chapter,
    previousLabel: bountyLabel(posterName, FIRST_AMOUNT),
  });
  const secondId = contentIdOf(editor);
  await expect(editor.getByTestId('card-previous')).toHaveText(
    bountyLabel(posterName, FIRST_AMOUNT),
  );
  // The editor sees the first poster superseded by the draft they wrote; the readers do not
  // until the second one is online.
  expect(await bountyValidity(editor, firstId)).toBe('SUPERSEDED');
  const unchanged = await getPublic(request, bountyPath('en', firstId));
  expect(unchanged.status(), await unchanged.text()).toBe(200);
  const stillActive: PublicBounty = await unchanged.json();
  expect(stillActive.validity).toBe('ACTIVE');
  await approve(crew, 'bounties', secondId);
  expect((await publish(crew, 'bounties', secondId)).status()).toBe(200);

  // The public API: the new poster is active, the old one superseded, the chain newest first.
  const second: PublicBounty = await (await getPublic(request, bountyPath('en', secondId))).json();
  expect(second).toMatchObject({ posterName, amount: SECOND_AMOUNT, validity: 'ACTIVE' });
  expect(second.chain.map((link) => [link.id, link.validity])).toEqual([
    [secondId, 'ACTIVE'],
    [firstId, 'SUPERSEDED'],
  ]);
  const first: PublicBounty = await (await getPublic(request, bountyPath('en', firstId))).json();
  expect(first.validity).toBe('SUPERSEDED');
  expect(first.chain.map((link) => link.id)).toEqual([secondId, firstId]);
  expect(first.image).toMatch(PUBLIC_IMAGE_PATH);
  const poster = await getPublic(request, `/${first.image}`);
  expect(poster.status()).toBe(200);
  expect(poster.headers()['content-type']).toBe('image/webp');

  // The card of the new poster lists the whole chain, newest first, itself marked.
  await editor.goto(`/content/bounties/${secondId}`);
  const chain = editor.getByTestId('chain-item');
  await expect(chain).toHaveCount(2);
  await expect(chain.nth(0)).toContainText(bountyLabel(posterName, SECOND_AMOUNT));
  await expect(editor.getByTestId('chain-current')).toContainText(
    bountyLabel(posterName, SECOND_AMOUNT),
  );
  await chain.nth(1).getByRole('link').click();
  await expect(editor).toHaveURL(new RegExp(`/bounties/${firstId}$`));
  await expect(editor.getByTestId('card-validity')).toHaveText('Superseded');

  // The section: amount and validity columns, text search, filters and the order by amount.
  await editor.goto(`/content/bounties?q=${encodeURIComponent(posterName)}`);
  const rows = editor.getByTestId('content-row');
  await expect(rows).toHaveCount(2);
  await editor.getByRole('button', { name: /Amount/ }).click();
  await expect(rows.first()).toContainText(berryText(FIRST_AMOUNT));
  await editor.getByRole('button', { name: /Amount/ }).click();
  await expect(rows.first()).toContainText(berryText(SECOND_AMOUNT));
  await editor.getByTestId('filter-validity').selectOption({ label: 'Superseded' });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(berryText(FIRST_AMOUNT));
  await editor.getByTestId('filter-validity').selectOption({ index: 0 });
  await editor.getByTestId('filter-condition').selectOption({ label: 'Only alive' });
  await expect(rows).toHaveCount(0);

  // The public list: only the online ones, the highest amount first, filtered by validity.
  const ours = async (query = '') => {
    const page: { content: PublicBountyLink[] } = await (
      await getPublic(request, `${bountyPath('en')}?q=${encodeURIComponent(posterName)}${query}`)
    ).json();
    return page.content.map((listed) => listed.id);
  };
  expect(await ours()).toEqual([secondId, firstId]);
  expect(await ours('&sort=amount,asc')).toEqual([firstId, secondId]);
  expect(await ours('&validity=SUPERSEDED')).toEqual([firstId]);
  expect(await ours('&condition=ONLY_ALIVE')).toEqual([]);

  // A new draft of the second poster withdraws it: its validity becomes inactive.
  await editor.goto(`/content/bounties/${secondId}`);
  await actOnRoute(editor, 'New draft from v1');
  await editor.locator('#draft-inactive').check();
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor).toHaveURL(/\?v=2$/);
  await approve(crew, 'bounties', secondId, 2);
  expect((await publish(crew, 'bounties', secondId, 2)).status()).toBe(200);
  const withdrawn: PublicBounty = await (
    await getPublic(request, bountyPath('en', secondId))
  ).json();
  expect(withdrawn.validity).toBe('INACTIVE');
  expect(withdrawn.chain.map((link) => link.validity)).toEqual(['INACTIVE', 'SUPERSEDED']);
  expect(await ours('&validity=INACTIVE')).toEqual([secondId]);

  // The card says upfront why the first poster cannot be retired, and the refusal names the
  // second one.
  const blocked = await blockedActions(publisher, firstCard);
  await expect(blocked).toContainText('Bounties are still online with this one');
  await expect(
    blocked.getByRole('link', { name: `${posterName} ${SECOND_AMOUNT}` }),
  ).toBeVisible();
  const refused = await retire(crew, 'bounties', firstId);
  expect(refused.status()).toBe(409);
  expect(await reasonOf(refused)).toBe('ONLINE_ITEMS_LINKED');

  // Newest first, everything retires and disappears from the public API.
  for (const [id, version] of [
    [secondId, 2],
    [firstId, 1],
  ] as const) {
    const response = await retire(crew, 'bounties', id, version);
    expect(response.status(), await response.text()).toBe(200);
    expect((await getPublic(request, bountyPath('en', id))).status()).toBe(404);
  }
  expect(await ours()).toEqual([]);
});

test('the chain rules refuse a second successor, a cycle and an offline previous bounty', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const crew = await crewOf(browser);
  const languages = await languageCodes(crew.editor);
  const chapter = await chapterIdOf(crew.editor, await onlineChapter(crew));
  const body = (posterName: string, amount: number, previous?: string) =>
    bountyBody(languages, { posterName, amount, chapter, previous });
  const online: [string, number][] = [];
  const goOnline = async (posterName: string, amount: number, previous?: string) => {
    const id = await putOnline(crew, 'bounties', body(posterName, amount, previous));
    online.push([id, 1]);
    return id;
  };
  const step = async (page: Crew['editor'], id: string, version: number, action: string) => {
    const response = await page.request.post(
      `/api/content/bounties/${id}/versions/${version}/${action}`,
    );
    expect(response.status(), `${action}: ${await response.text()}`).toBeLessThan(300);
  };

  // One successor at most: a second poster naming the same previous is refused on save.
  const roger = `E2E Roger ${stamp}`;
  const first = await goOnline(roger, 5_564_800_000);
  await goOnline(roger, 5_564_800_001, first);
  const twice = await saveBounty(crew.editor, body(roger, 5_564_800_002, first));
  expect(twice.status()).toBe(422);
  expect(JSON.stringify(await twice.json())).toContain('previous');

  // Not itself: a new version of the first cannot name its own content.
  await openNewVersion(crew.editor, first, 1);
  const itself = await crew.editor.request.put(`/api/content/bounties/${first}/versions/2`, {
    data: body(roger, 5_564_800_000, first),
  });
  expect(itself.status()).toBe(422);
  expect(JSON.stringify(await itself.json())).toContain('previous');

  // An offline previous bounty blocks the publication, with its reason, until it is online.
  const nami = `E2E Nami ${stamp}`;
  // (Saving needs the previous bounty approved, not online: it waits ready to be published.)
  const early = await draftBounty(crew, body(nami, 16_000_000));
  await approve(crew, 'bounties', early);
  const late = await draftBounty(crew, body(nami, 66_000_000, early));
  await approve(crew, 'bounties', late);
  const notYet = await publish(crew, 'bounties', late);
  expect(notYet.status()).toBe(409);
  expect(await reasonOf(notYet)).toBe('RELATED_NOT_ONLINE');
  expect(JSON.stringify(await notYet.json())).toContain('previous');
  expect((await publish(crew, 'bounties', early)).status()).toBe(200);
  online.push([early, 1]);
  expect((await publish(crew, 'bounties', late)).status()).toBe(200);
  online.push([late, 1]);

  // A cycle: two online posters each get a new version naming the other. Both pass the save
  // check (each looks at the approved versions), so the second publication is refused.
  const names = { a: `E2E Cycle A ${stamp}`, b: `E2E Cycle B ${stamp}` };
  // b goes online first: a's new version will name it, so a has to retire before b.
  const b = await goOnline(names.b, 2_000);
  const a = await goOnline(names.a, 1_000);
  for (const [id, name, other, amount] of [
    [a, names.a, b, 1_001],
    [b, names.b, a, 2_001],
  ] as const) {
    await openNewVersion(crew.editor, id, 1);
    const edited = await crew.editor.request.put(`/api/content/bounties/${id}/versions/2`, {
      data: body(name, amount, other),
    });
    expect(edited.status(), await edited.text()).toBeLessThan(300);
  }
  for (const id of [a, b]) {
    await step(crew.editor, id, 2, 'submit');
  }
  for (const id of [a, b]) {
    await step(crew.reviewer, id, 2, 'claim');
    await step(crew.reviewer, id, 2, 'approve');
  }
  expect((await publish(crew, 'bounties', a, 2)).status()).toBe(200);
  online[online.findIndex(([id]) => id === a)] = [a, 2];
  const cycle = await publish(crew, 'bounties', b, 2);
  expect(cycle.status()).toBe(409);
  expect(await reasonOf(cycle)).toBe('BOUNTY_CHAIN_CYCLE');

  // Cleanup: the draft left open by the self-reference check goes; the posters retire
  // newest first.
  const discarded = await crew.editor.request.delete(`/api/content/bounties/${first}/versions/2`);
  expect(discarded.status(), await discarded.text()).toBeLessThan(300);
  for (const [id, version] of online.reverse()) {
    const response = await retire(crew, 'bounties', id, version);
    expect(response.status(), await response.text()).toBe(200);
  }
});
