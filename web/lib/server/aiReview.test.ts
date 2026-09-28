import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_REVIEW_MODELS,
  AiReviewDisabled,
  AiReviewFailed,
  REVIEW_INSTRUCTIONS,
  aiReviewEnabled,
  buildReviewRequest,
  listAiReviews,
  requestAiReview,
  type ReviewClient,
  type ReviewProblem,
  type ReviewSubmission,
} from './aiReview';
import { InvalidInput, NotFoundError } from './errors';
import { prisma, setupTestDatabase } from './test/db';
import { makeQuestion, makeSubmission, makeTier, makeTopic, makeUser } from './test/factories';

setupTestDatabase();

const ON = { FEATURE_AI_REVIEW: 'true', ANTHROPIC_API_KEY: 'test-key-not-real' };

const problem: ReviewProblem = {
  title: 'Two Sum',
  difficulty: 'Easy',
  statementMd: 'Return indices of the two numbers that add up to `target`.',
  constraints: ['2 <= nums.length <= 10^4'],
  examples: [{ input: 'nums = [2,7,11,15], target = 9', output: '[0,1]' }],
  functionName: 'twoSum',
  signature: { params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]' },
};

const submission: ReviewSubmission = {
  language: 'python',
  code: 'def twoSum(nums, target):\n    seen = {}\n    ```tricky```\n',
  runtimeUs: 842,
  memoryKb: 575,
  percentile: 87.5,
  totalTests: 9,
};

type SystemBlock = { type: 'text'; text: string; cache_control?: { type: string } };

describe('prompt assembly', () => {
  it('puts the stable instructions first and cached, then the problem, then the code', () => {
    const req = buildReviewRequest(problem, submission, 'quick', {});
    const system = req.system as SystemBlock[];
    expect(system).toHaveLength(2);
    expect(system[0]).toEqual({ type: 'text', text: REVIEW_INSTRUCTIONS, cache_control: { type: 'ephemeral' } });
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1].text).toContain('## Problem: Two Sum (Easy)');
    expect(system[1].text).toContain('`twoSum(nums: int[], target: int) -> int[]`');
    expect(system[1].text).toContain('Input: nums = [2,7,11,15], target = 9');
    expect(system[1].text).toContain('- 2 <= nums.length <= 10^4');
    // Nothing learner-specific in the cached prefix.
    expect(JSON.stringify(system)).not.toContain('seen = {}');

    expect(req.messages).toHaveLength(1);
    const user = req.messages[0];
    expect(user.role).toBe('user');
    const text = user.content as string;
    expect(text).toContain('Depth: quick');
    expect(text).toContain('CPU time: 842 µs');
    expect(text).toContain('beats 87.5% of accepted python solutions');
    // The fence outgrows any backtick run inside the code.
    expect(text).toContain('````python\ndef twoSum');
  });

  it('is byte-stable across learners, so the prefix caches', () => {
    const a = buildReviewRequest(problem, submission, 'quick', {});
    const b = buildReviewRequest(problem, { ...submission, code: 'other', runtimeUs: 1 }, 'quick', {});
    expect(JSON.stringify(a.system)).toBe(JSON.stringify(b.system));
  });

  it('uses Haiku by default and Sonnet for the deeper review (env-overridable)', () => {
    expect(buildReviewRequest(problem, submission, 'quick', {}).model).toBe('claude-haiku-4-5-20251001');
    const deep = buildReviewRequest(problem, submission, 'deep', {});
    expect(deep.model).toBe('claude-sonnet-5');
    expect(deep.max_tokens).toBeGreaterThan(buildReviewRequest(problem, submission, 'quick', {}).max_tokens);
    expect((deep.messages[0].content as string).startsWith('Depth: deep')).toBe(true);
    expect(buildReviewRequest(problem, submission, 'deep', { AI_REVIEW_DEEP_MODEL: 'claude-opus-5' }).model).toBe('claude-opus-5');
    expect(AI_REVIEW_MODELS).toEqual({ quick: 'claude-haiku-4-5-20251001', deep: 'claude-sonnet-5' });
  });

  it('is off unless both the flag and a key are set', () => {
    expect(aiReviewEnabled({})).toBe(false);
    expect(aiReviewEnabled({ FEATURE_AI_REVIEW: 'true' })).toBe(false);
    expect(aiReviewEnabled({ ANTHROPIC_API_KEY: 'k' })).toBe(false);
    expect(aiReviewEnabled({ FEATURE_AI_REVIEW: '1', ANTHROPIC_API_KEY: 'k' })).toBe(false);
    expect(aiReviewEnabled(ON)).toBe(true);
  });
});

// ─── the stored flow, with a fake client ─────────────────────────────────

function fakeClient(reply: Partial<Anthropic.Message> & { text?: string } = {}) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ReviewClient = {
    messages: {
      async create(body) {
        calls.push(body);
        return {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: reply.text ?? '### Verdict\nClean hash-map solution.', citations: null },
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 120,
            output_tokens: 340,
            cache_creation_input_tokens: 900,
            cache_read_input_tokens: 0,
          },
          ...reply,
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

async function acceptedSubmission() {
  const tier = await makeTier(0);
  const topic = await makeTopic(tier.id);
  const q = await makeQuestion({ topics: [{ topicId: topic.id }] });
  const user = await makeUser();
  const sub = await makeSubmission(user.id, { questionId: q.id, kind: 'submit', status: 'OK', runtimeUs: 842, code: 'def solve(n): return n' });
  return { user, q, sub };
}

describe('requestAiReview', () => {
  it('reviews an accepted submission and stores it with token usage — once per model', async () => {
    const { user, sub } = await acceptedSubmission();
    const { client, calls } = fakeClient();
    const first = await requestAiReview(user.id, sub.id, 'quick', { client, env: ON });
    expect(first.cached).toBe(false);
    expect(first.review).toMatchObject({
      submissionId: sub.id,
      model: 'claude-haiku-4-5-20251001',
      depth: 'quick',
      contentMd: '### Verdict\nClean hash-map solution.',
      inputTokens: 1020,
      outputTokens: 340,
      cacheReadTokens: 0,
    });
    expect(calls).toHaveLength(1);
    expect((calls[0].messages[0].content as string)).toContain('def solve(n): return n');

    const again = await requestAiReview(user.id, sub.id, 'quick', { client, env: ON });
    expect(again).toMatchObject({ cached: true, review: { id: first.review.id } });
    expect(calls).toHaveLength(1);

    const deep = await requestAiReview(user.id, sub.id, 'deep', { client, env: ON });
    expect(deep.review).toMatchObject({ model: 'claude-sonnet-5', depth: 'deep' });
    expect(calls).toHaveLength(2);
    expect((await listAiReviews(user.id, sub.id, ON)).map((r) => r.depth)).toEqual(['quick', 'deep']);
    expect(await prisma.aiReview.count()).toBe(2);
  });

  it('never runs with the feature off, and never on anything but an accepted submit of your own', async () => {
    const { user, q, sub } = await acceptedSubmission();
    const { client, calls } = fakeClient();
    await expect(requestAiReview(user.id, sub.id, 'quick', { client, env: {} })).rejects.toBeInstanceOf(AiReviewDisabled);
    const wrong = await makeSubmission(user.id, { questionId: q.id, kind: 'submit', status: 'WA' });
    await expect(requestAiReview(user.id, wrong.id, 'quick', { client, env: ON })).rejects.toBeInstanceOf(InvalidInput);
    const run = await makeSubmission(user.id, { questionId: q.id, kind: 'run', status: 'OK' });
    await expect(requestAiReview(user.id, run.id, 'quick', { client, env: ON })).rejects.toBeInstanceOf(InvalidInput);
    const other = await makeUser();
    await expect(requestAiReview(other.id, sub.id, 'quick', { client, env: ON })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listAiReviews(other.id, sub.id, ON)).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(0);
    expect(await prisma.aiReview.count()).toBe(0);
  });

  it('stores nothing for a refusal or an empty reply, and notes a truncated one', async () => {
    const { user, sub } = await acceptedSubmission();
    const refused = fakeClient({ stop_reason: 'refusal' });
    await expect(requestAiReview(user.id, sub.id, 'quick', { client: refused.client, env: ON })).rejects.toBeInstanceOf(AiReviewFailed);
    const empty = fakeClient({ text: '   ' });
    await expect(requestAiReview(user.id, sub.id, 'quick', { client: empty.client, env: ON })).rejects.toThrow(/empty review/);
    expect(await prisma.aiReview.count()).toBe(0);
    const cut = fakeClient({ stop_reason: 'max_tokens' });
    const { review } = await requestAiReview(user.id, sub.id, 'quick', { client: cut.client, env: ON });
    expect(review.contentMd).toMatch(/cut off at its length limit/);
  });
});
