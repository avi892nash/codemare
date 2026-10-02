import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrismaEnums } from '../content-model/prisma-enums';
import { buildSavePayload, sameDraft, toDraft, type SavedRecipe } from '../extensions/codemare/src/recipe-editor/draft';
import { cuid } from '../extensions/codemare/src/shared/cuid';
import { toPgArrayLiteral } from '../extensions/codemare/src/shared/pg-array';

describe('pg array literals', () => {
  it('quotes and escapes every element', () => {
    const values = ['plain', 'with space', 'quote"d', 'back\\slash', 'com,ma', '{brace}', ''];
    expect(toPgArrayLiteral(values)).toBe('{"plain","with space","quote\\"d","back\\\\slash","com,ma","{brace}",""}');
  });

  it('writes NULL for missing elements and {} for an empty array', () => {
    expect(toPgArrayLiteral([null, 'x'])).toBe('{NULL,"x"}');
    expect(toPgArrayLiteral([])).toBe('{}');
  });
});

describe('cuid', () => {
  it('has the shape of Prisma cuid() ids and does not repeat', () => {
    const ids = Array.from({ length: 2000 }, cuid);
    for (const id of ids.slice(0, 20)) expect(id).toMatch(/^c[0-9a-z]{24}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parsePrismaEnums', () => {
  it('reads every enum of the real schema', () => {
    const schema = readFileSync(new URL('../../web/prisma/schema.prisma', import.meta.url), 'utf8');
    const enums = parsePrismaEnums(schema);
    expect(enums.Difficulty).toEqual(['Easy', 'Medium', 'Hard']);
    expect(enums.Language).toEqual(['python', 'javascript', 'typescript', 'cpp', 'java', 'go']);
    expect(enums.HintLevel).toEqual(['nudge', 'concept', 'pseudo', 'line', 'solution']);
  });

  it('honours @map and ignores comments and block attributes', () => {
    const enums = parsePrismaEnums('enum Kind {\n  a // first\n  b @map("bee")\n\n  @@schema("content")\n}\n');
    expect(enums.Kind).toEqual(['a', 'bee']);
  });
});

describe('buildSavePayload', () => {
  const saved: SavedRecipe[] = [
    {
      id: 'r1',
      topic_id: 't',
      title: 'First',
      ord: 0,
      items: [
        { id: 'i1', recipe_id: 'r1', token_topic_id: 'a', quantity: 2, min_difficulty: 'Easy' },
        { id: 'i2', recipe_id: 'r1', token_topic_id: 'b', quantity: 1, min_difficulty: 'Medium' },
      ],
    },
    { id: 'r2', topic_id: 't', title: 'Second', ord: 1, items: [{ id: 'i3', recipe_id: 'r2', token_topic_id: 'a', quantity: 1, min_difficulty: 'Easy' }] },
  ];

  it('is null when nothing changed', () => {
    expect(buildSavePayload(saved, toDraft(saved))).toBeNull();
    expect(sameDraft(toDraft(saved), toDraft(saved))).toBe(true);
  });

  it('sends only what changed: reorder, item edits, new and removed rows', () => {
    const draft = toDraft(saved);
    draft.reverse(); // Second first
    draft[1].items[0].quantity = 3; // First.i1
    draft[1].items.splice(1, 1); // drop First.i2
    draft[1].items.push({ key: 'k', tokenTopicId: 'c', quantity: 1, minDifficulty: 'Hard' });
    draft.push({ key: 'new', title: ' Third ', items: [{ key: 'k2', tokenTopicId: 'b', quantity: 2, minDifficulty: 'Easy' }] });

    expect(buildSavePayload(saved, draft)).toEqual({
      recipes: {
        create: [{ title: 'Third', ord: 2, items: [{ token_topic_id: 'b', quantity: 2, min_difficulty: 'Easy' }] }],
        update: [
          { id: 'r2', ord: 0 },
          {
            id: 'r1',
            ord: 1,
            items: {
              create: [{ token_topic_id: 'c', quantity: 1, min_difficulty: 'Hard' }],
              update: [{ id: 'i1', quantity: 3 }],
              delete: ['i2'],
            },
          },
        ],
        delete: [],
      },
    });
  });

  it('deletes removed recipes', () => {
    const draft = toDraft(saved).slice(0, 1);
    expect(buildSavePayload(saved, draft)).toEqual({ recipes: { create: [], update: [], delete: ['r2'] } });
  });
});
