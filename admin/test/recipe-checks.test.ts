import { describe, expect, it } from 'vitest';
import {
  checkTopicRecipes,
  recipeCosts,
  unlockableTopics,
  type RecipeDraft,
  type RecipeShape,
  type TopicInfo,
} from '../extensions/codemare/src/shared/recipe-checks';

const topics: TopicInfo[] = [
  { id: 'arrays', slug: 'arrays', title: 'Arrays', tierOrd: 0 },
  { id: 'stack', slug: 'stack', title: 'Stack', tierOrd: 0 },
  { id: 'bsearch', slug: 'bsearch', title: 'Binary Search', tierOrd: 1 },
  { id: 'graphs', slug: 'graphs', title: 'Graphs', tierOrd: 2 },
];

const item = (key: string, tokenTopicId: string | null, quantity: number | null = 1, minDifficulty: 'Easy' | 'Medium' | 'Hard' | null = 'Easy') => ({
  key,
  id: key,
  tokenTopicId,
  quantity,
  minDifficulty,
});

const recipe = (key: string, title: string, items: RecipeDraft['items']): RecipeDraft => ({ key, id: key, title, items });

const saved = new Map<string, RecipeShape[]>([
  ['bsearch', [{ items: [{ tokenTopicId: 'arrays' }] }]],
  ['graphs', [{ items: [{ tokenTopicId: 'bsearch' }] }]],
]);

const check = (topicId: string, draft: RecipeDraft[], supply?: Parameters<typeof checkTopicRecipes>[0]['supply']) =>
  checkTopicRecipes({ topic: topics.find((t) => t.id === topicId)!, draft, topics, saved, supply });

const errors = (issues: ReturnType<typeof check>) => issues.filter((i) => i.severity === 'error').map((i) => i.message);
const warnings = (issues: ReturnType<typeof check>) => issues.filter((i) => i.severity === 'warning').map((i) => i.message);

describe('checkTopicRecipes', () => {
  it('accepts a valid recipe set', () => {
    const issues = check('bsearch', [recipe('r1', 'Scan, then search', [item('i1', 'arrays', 2), item('i2', 'stack', 1, 'Medium')])]);
    expect(errors(issues)).toEqual([]);
  });

  it('refuses a recipe that spends the topic’s own tokens', () => {
    const issues = check('bsearch', [recipe('r1', 'Loop', [item('i1', 'bsearch', 1)])]);
    expect(errors(issues).join(' ')).toMatch(/cannot spend Binary Search tokens/);
    expect(issues.find((i) => i.itemKey === 'i1')?.severity).toBe('error');
  });

  it('refuses quantities that are not whole numbers ≥ 1, unknown topics and missing fields', () => {
    const issues = check('bsearch', [
      recipe('r1', 'Bad', [item('a', 'arrays', 0), item('b', 'arrays', 1.5), item('c', 'nope'), item('d', null), item('e', 'stack', 1, null)]),
    ]);
    const byItem = (k: string) => issues.filter((i) => i.itemKey === k && i.severity === 'error').length;
    expect(byItem('a')).toBe(1);
    expect(byItem('b')).toBe(1);
    expect(byItem('c')).toBe(1);
    expect(byItem('d')).toBe(1);
    expect(byItem('e')).toBe(1);
  });

  it('refuses untitled or empty recipes and a tier > 0 topic without recipes', () => {
    expect(errors(check('bsearch', [recipe('r1', '  ', [item('i', 'arrays')])]))).toContain('Give this recipe a title.');
    expect(errors(check('bsearch', [recipe('r1', 'Empty', [])])).join(' ')).toMatch(/has no items/);
    expect(errors(check('bsearch', [])).join(' ')).toMatch(/needs at least one recipe/);
  });

  it('refuses changes that make another topic impossible to unlock', () => {
    // Graphs needs Binary Search tokens; making Binary Search depend on Graphs locks both.
    const issues = check('bsearch', [recipe('r1', 'Cycle', [item('i1', 'graphs', 1)])]);
    expect(errors(issues).join(' ')).toMatch(/Binary Search could never be unlocked/);
    expect(errors(issues).join(' ')).toMatch(/make Graphs impossible to unlock/);
  });

  it('warns about free-tier recipes, duplicate token topics and higher tiers', () => {
    expect(warnings(check('arrays', [recipe('r1', 'Pointless', [item('i', 'stack')])])).join(' ')).toMatch(/free tier/);
    const dup = check('bsearch', [recipe('r1', 'Twice', [item('a', 'arrays', 1), item('b', 'arrays', 2)])]);
    expect(warnings(dup).join(' ')).toMatch(/appears 2 times/);
    const up = check('bsearch', [recipe('r1', 'Up', [item('a', 'arrays'), item('b', 'graphs')])]);
    expect(warnings(up).join(' ')).toMatch(/tier 2, above Binary Search/);
  });

  it('warns when the published content cannot pay for a recipe', () => {
    const supply = { arrays: { Easy: 3 }, stack: { Medium: 2 } };
    const ok = check('bsearch', [recipe('r1', 'Fits', [item('i', 'arrays', 3)])], supply);
    expect(warnings(ok)).toEqual([]);
    const tooMuch = check('bsearch', [recipe('r1', 'Greedy', [item('i', 'arrays', 4)])], supply);
    expect(warnings(tooMuch).join(' ')).toMatch(/Arrays Easy\+ \(3 of 4\)/);
    expect(warnings(tooMuch).join(' ')).toMatch(/No recipe of Binary Search fits/);
  });
});

describe('unlockableTopics', () => {
  it('matches the seed validator fixpoint', () => {
    expect([...unlockableTopics(topics, (id) => saved.get(id) ?? [])].sort()).toEqual(['arrays', 'bsearch', 'graphs', 'stack']);
    expect([...unlockableTopics(topics, () => [])].sort()).toEqual(['arrays', 'stack']);
  });
});

describe('recipeCosts', () => {
  it('totals tokens, marks the cheapest recipe and reports what the content offers', () => {
    const draft = [
      recipe('big', 'Big', [item('a', 'arrays', 3), item('b', 'stack', 2, 'Medium')]),
      recipe('small', 'Small', [item('c', 'arrays', 2)]),
      recipe('tie', 'Tie', [item('d', 'stack', 2)]),
    ];
    const costs = recipeCosts(draft, topics, { arrays: { Easy: 1, Medium: 4 }, stack: { Hard: 5 } });
    expect(costs.map((c) => c.totalTokens)).toEqual([5, 2, 2]);
    // Tie on tokens → lower ord wins.
    expect(costs.map((c) => c.cheapest)).toEqual([false, true, false]);
    expect(costs[0].lines[1]).toMatchObject({ text: '2 × Stack, Medium or harder', onOffer: 5 });
    expect(costs[1].lines[0].onOffer).toBe(5);
    expect(costs[0].affordable).toBe(true);
  });
});
