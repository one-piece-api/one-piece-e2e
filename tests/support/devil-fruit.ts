/** What the content API saves a Devil Fruit Type with; `chapter` is a content id. */
export function fruitTypeBody(
  languages: string[],
  draft: { romaji: string; name: string; chapter: string },
): Record<string, unknown> {
  return {
    romaji: draft.romaji,
    firstAppearance: { chapter: draft.chapter },
    translations: textsOf(languages, draft.name),
  };
}

/** What the content API saves a Devil Fruit with; `type` and `chapter` are content ids. */
export function devilFruitBody(
  languages: string[],
  draft: {
    romaji: string;
    name: string;
    type: string;
    chapter: string;
    multipleUsers?: boolean;
  },
): Record<string, unknown> {
  return {
    romaji: draft.romaji,
    type: draft.type,
    multipleUsers: draft.multipleUsers ?? false,
    firstAppearance: { chapter: draft.chapter },
    translations: textsOf(languages, draft.name),
  };
}

function textsOf(languages: string[], name: string) {
  return Object.fromEntries(
    languages.map((code) => [
      code,
      {
        name: `${name} (${code})`,
        description: `${name} described in ${code}.`,
        advantages: `${name} advantages in ${code}.`,
        disadvantages: `${name} disadvantages in ${code}.`,
      },
    ]),
  );
}
