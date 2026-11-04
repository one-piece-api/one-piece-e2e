import { chapterIdOf } from './bounty';
import {
  arcOf,
  Crew,
  freshNumber,
  languageCodes,
  onlineChapter,
  putOnline,
  translationsOf,
} from './story';

/** A point of the story on both reader axes: a chapter and an episode, online, by id and number. */
export interface StoryPoint {
  chapterId: string;
  episodeId: string;
  chapter: number;
  episode: number;
}

/** The points put online, in the order of the story, with the arc they belong to. */
export interface StoryPoints {
  languages: string[];
  arc: string;
  points: StoryPoint[];
}

/**
 * Puts one chapter and one episode online for each label, in one arc and in the order of the
 * story: numbers are unique forever, so they are fresh and increase along both axes. The first
 * chapter brings its own saga and arc.
 */
export async function putStoryPointsOnline(crew: Crew, labels: string[]): Promise<StoryPoints> {
  const { editor } = crew;
  const languages = await languageCodes(editor);
  const firstChapter = await onlineChapter(crew);
  const firstChapterId = await chapterIdOf(editor, firstChapter);
  const arc = await arcOf(editor, firstChapterId);
  const points: StoryPoint[] = [];
  for (const [index, label] of labels.entries()) {
    const chapter = index === 0 ? firstChapter : freshNumber();
    const chapterId =
      index === 0
        ? firstChapterId
        : await putOnline(crew, 'chapters', {
            number: chapter,
            arc,
            releases: [{ country: 'JP', date: '2020-05-01' }],
            translations: translationsOf(languages, `E2E ${label} chapter ${chapter}`),
          });
    const episode = freshNumber();
    const episodeId = await putOnline(crew, 'episodes', {
      number: episode,
      arc,
      japaneseTitle: `E2E ${episode}`,
      broadcasts: [{ country: 'JP', date: '2022-02-02' }],
      translations: translationsOf(languages, `E2E ${label} episode ${episode}`),
    });
    points.push({ chapterId, episodeId, chapter, episode });
  }
  return { languages, arc, points };
}
