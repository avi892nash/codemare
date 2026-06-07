/**
 * Prisma seed: imports every problem JSON from backend/src/data/problems/
 * into the `Problem` table. Idempotent — re-running upserts in place by slug.
 *
 * The schema's `harnessTemplate` and `tags` columns are populated empty for
 * the bootstrap problems (no C++/Java harness yet, no taxonomy yet).
 *
 * Run with: `npx tsx prisma/seed.ts` (or via the configured prisma seed hook).
 */
import { PrismaClient, Difficulty, Prisma } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();

const here = dirname(fileURLToPath(import.meta.url));
// Walk up to repo root: web/prisma → web → repo
const PROBLEMS_DIR = join(here, '..', '..', 'backend', 'src', 'data', 'problems');

interface RawProblem {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  examples: Array<{ input: string; output: string; explanation?: string }>;
  constraints: string[];
  testCases: Array<{ input: unknown[]; expectedOutput: unknown; hidden?: boolean }>;
  starterCode: Record<string, string>;
  functionName: string;
}

async function main() {
  const files = readdirSync(PROBLEMS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
  if (files.length === 0) {
    console.log('seed: no problem JSON files found at', PROBLEMS_DIR);
    return;
  }

  for (const file of files) {
    const raw: RawProblem = JSON.parse(readFileSync(join(PROBLEMS_DIR, file), 'utf8'));
    // Prisma's JSON columns expect `InputJsonValue`; the raw JS objects we
    // load satisfy the runtime shape but the structural types from JSON.parse
    // (e.g. `unknown[]`) don't unify with Prisma's `InputJsonObject`. Cast to
    // the documented JSON wrapper to keep the seed strict and explicit.
    const J = (v: unknown) => v as Prisma.InputJsonValue;
    await prisma.problem.upsert({
      where: { slug: raw.id },
      create: {
        slug: raw.id,
        title: raw.title,
        difficulty: raw.difficulty as Difficulty,
        description: raw.description,
        examples: J(raw.examples),
        constraints: J(raw.constraints),
        starterCode: J(raw.starterCode),
        functionName: raw.functionName,
        harnessTemplate: Prisma.JsonNull,
        testCases: J(raw.testCases),
        tags: [],
      },
      update: {
        title: raw.title,
        difficulty: raw.difficulty as Difficulty,
        description: raw.description,
        examples: J(raw.examples),
        constraints: J(raw.constraints),
        starterCode: J(raw.starterCode),
        functionName: raw.functionName,
        testCases: J(raw.testCases),
      },
    });
    console.log(`seed: ${raw.id} (${raw.title})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('seed: failed —', err);
    await prisma.$disconnect();
    process.exit(1);
  });
