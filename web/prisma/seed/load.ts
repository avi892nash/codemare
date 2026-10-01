/**
 * Typed, zod-validated loaders — one per content domain. Each reads its
 * files from a seed directory and returns parsed data; every problem in
 * every file is collected (not just the first) and reported together.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { z } from 'zod';
import {
  areaFileSchema,
  badgesFileSchema,
  loopFileSchema,
  questionFileSchema,
  trackFileSchema,
  type AreaFile,
  type BadgesFile,
  type LoopFile,
  type QuestionFile,
  type SeedBundle,
  type Sourced,
  type TrackFile,
} from './types';

/** Thrown with every problem found, one per line. */
export class SeedError extends Error {
  constructor(
    readonly problems: string[],
    heading = 'seed data is invalid'
  ) {
    super(`${heading} (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n  - ${problems.join('\n  - ')}`);
    this.name = 'SeedError';
  }
}

type Parsed<T> = { value: T | null; problems: string[] };

function parseFile<S extends z.ZodTypeAny>(dir: string, rel: string, schema: S): Parsed<z.output<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
  } catch (e) {
    return { value: null, problems: [`${rel}: cannot read JSON (${(e as Error).message})`] };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { value: r.data, problems: [] };
  return {
    value: null,
    problems: r.error.issues.map((i) => `${rel}: ${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`),
  };
}

function jsonFiles(dir: string, sub: string): string[] {
  const full = join(dir, sub);
  if (!existsSync(full) || !statSync(full).isDirectory()) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `${sub}/${f}`);
}

/** Many one-entity-per-file documents whose file name must equal their slug. */
function loadDir<S extends z.ZodTypeAny>(
  dir: string,
  sub: string,
  schema: S
): { items: Sourced<z.output<S>>[]; problems: string[] } {
  const items: Sourced<z.output<S>>[] = [];
  const problems: string[] = [];
  for (const file of jsonFiles(dir, sub)) {
    const { value, problems: p } = parseFile(dir, file, schema);
    problems.push(...p);
    if (!value) continue;
    const expected = basename(file, '.json');
    if ((value as { slug: string }).slug !== expected) {
      problems.push(`${file}: slug "${(value as { slug: string }).slug}" must match the file name "${expected}"`);
    }
    items.push({ file, data: value });
  }
  return { items, problems };
}

/** `loop.json` (required): tiers, topics, recipes, gates. */
export function loadLoop(dir: string): { loop: Sourced<LoopFile> | null; problems: string[] } {
  if (!existsSync(join(dir, 'loop.json'))) return { loop: null, problems: ['loop.json: missing (required)'] };
  const { value, problems } = parseFile(dir, 'loop.json', loopFileSchema);
  return { loop: value ? { file: 'loop.json', data: value } : null, problems };
}

/** `questions/<slug>.json` (at least one required). */
export function loadQuestions(dir: string): { questions: Sourced<QuestionFile>[]; problems: string[] } {
  const { items, problems } = loadDir(dir, 'questions', questionFileSchema);
  if (jsonFiles(dir, 'questions').length === 0) problems.push('questions/: no question files (at least one required)');
  return { questions: items, problems };
}

/** `badges.json` (optional). */
export function loadBadges(dir: string): { badges: Sourced<BadgesFile> | null; problems: string[] } {
  if (!existsSync(join(dir, 'badges.json'))) return { badges: null, problems: [] };
  const { value, problems } = parseFile(dir, 'badges.json', badgesFileSchema);
  return { badges: value ? { file: 'badges.json', data: value } : null, problems };
}

/** `learn/<track>.json` (optional directory). */
export function loadLearn(dir: string): { tracks: Sourced<TrackFile>[]; problems: string[] } {
  const { items, problems } = loadDir(dir, 'learn', trackFileSchema);
  return { tracks: items, problems };
}

/** `library/<area>.json` (optional directory). */
export function loadLibrary(dir: string): { areas: Sourced<AreaFile>[]; problems: string[] } {
  const { items, problems } = loadDir(dir, 'library', areaFileSchema);
  return { areas: items, problems };
}

/** Load and schema-check a whole seed directory; throws SeedError listing every problem. */
export function loadSeedDir(dir: string): SeedBundle {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new SeedError([`${dir}: not a directory`], 'seed directory not found');
  }
  const loop = loadLoop(dir);
  const questions = loadQuestions(dir);
  const badges = loadBadges(dir);
  const learn = loadLearn(dir);
  const library = loadLibrary(dir);
  const problems = [
    ...loop.problems,
    ...questions.problems,
    ...badges.problems,
    ...learn.problems,
    ...library.problems,
  ];
  if (problems.length > 0 || !loop.loop) throw new SeedError(problems);
  return {
    dir,
    loop: loop.loop,
    questions: questions.questions,
    badges: badges.badges,
    tracks: learn.tracks,
    areas: library.areas,
  };
}
