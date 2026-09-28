/**
 * The shipped learn content (prisma/seed/data/learn/*.json) against the
 * lesson-markdown contract: every directive is known and well-formed, every
 * visualization is registered, every question card points at a real
 * question, and every runnable block is in a language the runner supports.
 * (Schema and cross-file checks run in prisma/seed/content.test.ts.)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isVizId } from '@/components/Viz/ids';
import { trackFileSchema, type TrackFile } from '@/prisma/seed/types';
import { CALLOUT_KINDS, parseLesson, walkBlocks, type LessonBlock } from './parse';

const root = join(__dirname, '../../prisma/seed/data');
const learnDir = join(root, 'learn');
const questionSlugs = new Set(
  existsSync(join(root, 'questions')) ? readdirSync(join(root, 'questions')).map((f) => f.replace(/\.json$/, '')) : []
);
const files = existsSync(learnDir) ? readdirSync(learnDir).filter((f) => f.endsWith('.json')) : [];
const tracks: { file: string; track: TrackFile }[] = files.map((file) => ({
  file,
  track: trackFileSchema.parse(JSON.parse(readFileSync(join(learnDir, file), 'utf8'))),
}));

/** Languages the compile service's IDE mode runs today. */
const RUNNABLE = new Set(['python', 'py', 'javascript', 'js', 'cpp', 'c++', 'java']);
/** Static route segments a lesson slug must not shadow. */
const RESERVED = new Set(['complete', 'checkpoint']);

describe.skipIf(tracks.length === 0)('learn content', () => {
  it('ships three tracks in display order with 2–3 modules and 2–4 lessons each', () => {
    expect(tracks.length).toBe(3);
    expect(tracks.map((t) => t.track.ord).sort()).toEqual([0, 1, 2]);
    for (const { track } of tracks) {
      expect(track.modules.length).toBeGreaterThanOrEqual(2);
      expect(track.modules.length).toBeLessThanOrEqual(3);
      for (const m of track.modules) {
        expect(m.lessons.length, `${track.slug}/${m.slug}`).toBeGreaterThanOrEqual(2);
        expect(m.lessons.length, `${track.slug}/${m.slug}`).toBeLessThanOrEqual(4);
        expect(m.checkpoint.length, `${track.slug}/${m.slug} checkpoint`).toBeGreaterThanOrEqual(3);
        expect(m.checkpoint.length, `${track.slug}/${m.slug} checkpoint`).toBeLessThanOrEqual(5);
      }
    }
  });

  for (const { file, track } of tracks) {
    describe(file, () => {
      it('uses only known directives, with valid attributes', () => {
        for (const m of track.modules) {
          for (const l of m.lessons) {
            for (const line of l.body_md.split('\n')) {
              const d = /^ {0,3}:::([A-Za-z-]+)/.exec(line);
              if (d) expect(['callout', 'viz', 'question'], `${l.slug}: ${line}`).toContain(d[1]);
              const kind = /^ {0,3}:::callout\{[^}]*kind=([a-z]+)/.exec(line);
              if (kind) expect(CALLOUT_KINDS as readonly string[], `${l.slug}: ${line}`).toContain(kind[1]);
            }
            // Every leaf directive survives parsing (bad attributes would drop it).
            const raw = (l.body_md.match(/^ {0,3}:::(viz|question)\{/gm) ?? []).length;
            const blocks = [...walkBlocks(parseLesson(l.body_md))];
            expect(blocks.filter((b) => b.type === 'viz' || b.type === 'question').length, l.slug).toBe(raw);
          }
        }
      });

      it('registers every visualization and has at least one per module', () => {
        for (const m of track.modules) {
          const ids = m.lessons.flatMap((l) => [...walkBlocks(parseLesson(l.body_md))].filter((b) => b.type === 'viz').map((b) => (b as { id: string }).id));
          expect(ids.length, `${m.slug} has no visualization`).toBeGreaterThan(0);
          for (const id of ids) expect(isVizId(id), `unknown viz "${id}"`).toBe(true);
        }
      });

      it('links question cards and related questions to real questions', () => {
        for (const m of track.modules) {
          for (const l of m.lessons) {
            const blocks = [...walkBlocks(parseLesson(l.body_md))];
            for (const b of blocks) if (b.type === 'question') expect(questionSlugs.has(b.slug), `${l.slug}: ${b.slug}`).toBe(true);
            for (const s of l.related_question_slugs) expect(questionSlugs.has(s), `${l.slug}: ${s}`).toBe(true);
            expect(l.related_question_slugs.length, `${l.slug} has no related questions`).toBeGreaterThan(0);
          }
        }
      });

      it('gives every lesson prose, a runnable snippet in a supported language, and a callout', () => {
        for (const m of track.modules) {
          for (const l of m.lessons) {
            expect(RESERVED.has(l.slug), `${l.slug} shadows a route`).toBe(false);
            const blocks: LessonBlock[] = [...walkBlocks(parseLesson(l.body_md))];
            const runnable = blocks.filter((b): b is Extract<LessonBlock, { type: 'code' }> => b.type === 'code' && b.run);
            expect(runnable.length, `${l.slug} has no runnable snippet`).toBeGreaterThan(0);
            for (const r of runnable) expect(RUNNABLE.has((r.lang ?? '').toLowerCase()), `${l.slug}: ${r.lang}`).toBe(true);
            expect(blocks.some((b) => b.type === 'markdown'), l.slug).toBe(true);
            expect(blocks.some((b) => b.type === 'callout'), l.slug).toBe(true);
          }
        }
      });

      it('writes checkpoints with valid answers and an explanation for each', () => {
        for (const m of track.modules) {
          for (const q of m.checkpoint) {
            expect(q.explanation_md.trim(), q.prompt_md).not.toBe('');
            if (q.kind === 'mcq') {
              expect(new Set(q.choices).size, q.prompt_md).toBe(q.choices.length);
              expect(q.answer).toBeLessThan(q.choices.length);
            }
          }
        }
      });
    });
  }
});
