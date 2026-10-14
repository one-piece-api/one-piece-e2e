import { expect, test } from '@playwright/test';
import { signIn } from './support/crew';
import { getPublic, PublicStorySpan, storyPath } from './support/public-api';
import {
  approve,
  createDraft,
  Crew,
  freshNumber,
  languageCodes,
  publish,
  putOnline,
  reasonOf,
  retire,
  translationsOf,
} from './support/story';

// The story structure through the whole loop (story-structure plan, step SS7): saga -> arc ->
// volume -> chapter -> episode written and reviewed through the content API with real
// sessions, published in dependency order, read back from the public API with their derived
// spans, and the publish / retire blocks that keep the chain consistent. Only the Japanese
// release counts for a span, and only online items count.

test('the story chain goes online in order, spans follow what is online, blocks keep it consistent', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const base = freshNumber();
  const crew: Crew = {
    editor: await signIn(browser, 'chopper'),
    reviewer: await signIn(browser, 'zoro'),
    publisher: await signIn(browser, 'vivi'),
  };
  const languages = await languageCodes(crew.editor);
  const titled = (title: string) => translationsOf(languages, title);

  // Drafts, bottom-up: nothing is online yet.
  const sagaId = await createDraft(crew.editor, 'sagas', {
    number: base,
    translations: titled(`E2E Saga ${base}`),
  });
  await approve(crew, 'sagas', sagaId);
  const arcId = await createDraft(crew.editor, 'arcs', {
    number: base,
    saga: sagaId,
    translations: titled(`E2E Arc ${base}`),
  });
  await approve(crew, 'arcs', arcId);

  // A child cannot go online before its parent.
  const early = await publish(crew, 'arcs', arcId);
  expect(early.status()).toBe(409);
  expect(await reasonOf(early)).toBe('RELATED_NOT_ONLINE');
  expect((await publish(crew, 'sagas', sagaId)).status()).toBe(200);
  expect((await publish(crew, 'arcs', arcId)).status()).toBe(200);

  const volumeId = await putOnline(crew, 'volumes', {
    number: base,
    japaneseTitle: `ワンピース ${base}`,
    releases: [{ country: 'JP', date: '2020-06-04' }],
    translations: titled(`E2E Volume ${base}`),
  });
  const firstChapter = await putOnline(crew, 'chapters', {
    number: base,
    arc: arcId,
    volume: volumeId,
    pageCount: 19,
    // Italy comes earlier than Japan here: only the Japanese date may reach the span.
    releases: [
      { country: 'JP', date: '2020-05-01' },
      { country: 'IT', date: '2019-01-01' },
    ],
    translations: titled(`E2E Chapter ${base}`),
  });
  const secondChapterId = await createDraft(crew.editor, 'chapters', {
    number: base + 1,
    arc: arcId,
    releases: [{ country: 'JP', date: '2021-03-01' }],
    translations: titled(`E2E Chapter ${base + 1}`),
  });
  await approve(crew, 'chapters', secondChapterId);
  const episodeId = await putOnline(crew, 'episodes', {
    number: base,
    arc: arcId,
    japaneseTitle: `E2E ${base}`,
    broadcasts: [
      { country: 'JP', date: '2022-02-02' },
      { country: 'IT', date: '2030-01-01' },
    ],
    translations: titled(`E2E Episode ${base}`),
  });

  const read = async (entity: string, slug: string, query = '') =>
    (await getPublic(request, `${storyPath('en', entity, slug)}${query}`)).json();
  const span = (detail: { chapters: PublicStorySpan }) => detail.chapters;

  // One online chapter: the span covers it, with its Japanese date only.
  const arc = await read('arcs', `${base}`);
  expect(arc.saga.number).toBe(base);
  expect(span(arc)).toEqual({
    count: 1,
    firstNumber: base,
    lastNumber: base,
    firstDate: '2020-05-01',
    lastDate: '2020-05-01',
  });
  expect(arc.episodes).toMatchObject({ count: 1, firstDate: '2022-02-02' });
  const chapter = await read('chapters', `${base}`);
  expect(chapter.arc.number).toBe(base);
  expect(chapter.volume.number).toBe(base);
  expect(chapter.releases).toHaveLength(2);

  // The second chapter, still approved, is invisible to the spans until it goes online.
  expect(span(await read('sagas', `${base}`)).count).toBe(1);
  expect((await publish(crew, 'chapters', secondChapterId)).status()).toBe(200);
  expect(span(await read('sagas', `${base}`))).toMatchObject({
    count: 2,
    firstNumber: base,
    lastNumber: base + 1,
    lastDate: '2021-03-01',
  });
  const volume = await read('volumes', `${base}`);
  expect(span(volume).count).toBe(1);
  // Japanese script survives the whole way (the "?9201" seen from a shell was the shell's).
  expect(volume.japaneseTitle).toBe(`ワンピース ${base}`);

  // Filters: the arc's chapters, the volume's chapters, the saga's arcs.
  const inArc = await read('chapters', '', `?arc=${base}&sort=number`);
  expect(inArc.content.map((listed: { number: number }) => listed.number)).toEqual([
    base,
    base + 1,
  ]);
  const inVolume = await read('chapters', '', `?volume=${base}`);
  expect(inVolume.content.map((listed: { id: string }) => listed.id)).toEqual([firstChapter]);
  const inSaga = await read('arcs', '', `?saga=${base}`);
  expect(inSaga.content.map((listed: { id: string }) => listed.id)).toEqual([arcId]);
  const ofArc = await read('episodes', '', `?arc=${base}`);
  expect(ofArc.content.map((listed: { id: string }) => listed.id)).toEqual([episodeId]);

  // Retiring a child updates the spans; its public page is gone.
  expect((await retire(crew, 'chapters', secondChapterId)).status()).toBe(200);
  expect((await getPublic(request, storyPath('en', 'chapters', `${base + 1}`))).status()).toBe(404);
  expect(span(await read('arcs', `${base}`))).toMatchObject({
    count: 1,
    lastNumber: base,
  });

  // A parent cannot go while online children link to it.
  for (const [entity, id] of [
    ['volumes', volumeId],
    ['arcs', arcId],
    ['sagas', sagaId],
  ] as const) {
    const refused = await retire(crew, entity, id);
    expect(refused.status(), entity).toBe(409);
    expect(await reasonOf(refused), entity).toBe('ONLINE_ITEMS_LINKED');
  }

  // Bottom-up, everything retires, and the public API forgets the whole chain.
  for (const [entity, id] of [
    ['episodes', episodeId],
    ['chapters', firstChapter],
    ['volumes', volumeId],
    ['arcs', arcId],
    ['sagas', sagaId],
  ] as const) {
    const response = await retire(crew, entity, id);
    expect(response.status(), `${entity}: ${await response.text()}`).toBe(200);
    expect((await getPublic(request, storyPath('en', entity, id))).status(), entity).toBe(404);
  }
});
