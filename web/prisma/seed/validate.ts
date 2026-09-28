/**
 * Cross-file validation of a parsed seed bundle — everything the per-file
 * zod schemas cannot see. Pure: returns every error and warning at once.
 *
 * Errors (seeding refuses to run):
 *   · duplicate slugs / tier ords; not exactly one free tier (ord 0)
 *   · unknown references: tier, topic, component, question slugs anywhere
 *   · a topic in a tier > 0 without a recipe, or one that can never be
 *     unlocked: its recipes need tokens of topics that are still locked, or
 *     more tokens than all published questions and build steps pay out
 *     (warning: the cheapest recipes of all topics together exceed that)
 *   · a tier > 0 without a gate, a gate on the free tier, a gate question
 *     missing from questions/, pass_threshold above the question count
 *   · component dependency cycles (incl. self-dependency)
 *   · hint ladders with duplicate levels or gaps (must climb from nudge)
 *   · test inputs whose length differs from the signature's params
 *   · build starter code for a language the component is not built in
 *   · Go stubs with a `package` clause or imports (the harness adds them)
 *   · lesson slugs repeated within a track (routes are /learn/[track]/[lesson])
 */
import type { Difficulty } from '../../lib/types';
import { findCycle, graphFromEdges } from '../../lib/server/rules/graph';
import { ladderGaps } from '../../lib/server/rules/hints';
import { balancesFromRows, planDebits, type Requirement } from '../../lib/server/rules/recipes';
import { buildAward, solveAward } from '../../lib/server/rules/scoring';
import type { Hint, SeedBundle } from './types';

export interface SeedReport {
  errors: string[];
  warnings: string[];
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
}

export function validateSeed(seed: SeedBundle): SeedReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unique = (kind: string, values: readonly string[], where: string) => {
    for (const d of duplicates(values)) errors.push(`${where}: duplicate ${kind} "${d}"`);
  };

  const L = seed.loop.data;
  const lf = seed.loop.file;

  const checkHints = (where: string, hints: readonly Hint[]) => {
    const levels = hints.map((h) => h.level);
    unique('hint level', levels, where);
    const gaps = ladderGaps(levels);
    if (gaps.length) {
      errors.push(`${where}: hint levels must climb from nudge without gaps — missing ${gaps.join(', ')}`);
    }
  };
  const checkTests = (where: string, tests: readonly { input: unknown[] }[], params: number) => {
    tests.forEach((t, i) => {
      if (t.input.length !== params) {
        errors.push(`${where}: tests[${i}].input has ${t.input.length} argument(s); the signature takes ${params}`);
      }
    });
  };
  const checkGo = (where: string, code: string | undefined) => {
    if (code && /^\s*(package|import)\b/m.test(code)) {
      errors.push(`${where}: Go stubs must not have a package clause or imports (the harness adds them)`);
    }
  };

  // ── tiers ──
  unique('tier slug', L.tiers.map((t) => t.slug), lf);
  unique('tier ord', L.tiers.map((t) => String(t.ord)), lf);
  const freeTiers = L.tiers.filter((t) => t.ord === 0).length;
  if (freeTiers !== 1) errors.push(`${lf}: exactly one tier must have ord 0 (the free tier); found ${freeTiers}`);
  const tierBySlug = new Map(L.tiers.map((t) => [t.slug, t]));

  // ── topics ──
  unique('topic slug', L.topics.map((t) => t.slug), lf);
  const topicBySlug = new Map(L.topics.map((t) => [t.slug, t]));
  const tierOrdOf = (topicSlug: string) => tierBySlug.get(topicBySlug.get(topicSlug)?.tier ?? '')?.ord;
  L.topics.forEach((t, i) => {
    if (!tierBySlug.has(t.tier)) errors.push(`${lf}: topics[${i}] "${t.slug}": unknown tier "${t.tier}"`);
  });

  // ── recipes ──
  L.recipes.forEach((r, i) => {
    const where = `${lf}: recipes[${i}] "${r.title}"`;
    if (!topicBySlug.has(r.topic)) errors.push(`${where}: unknown topic "${r.topic}"`);
    else if (tierOrdOf(r.topic) === 0) warnings.push(`${where}: "${r.topic}" is in the free tier, so this recipe is never used`);
    r.items.forEach((it, j) => {
      if (!topicBySlug.has(it.topic)) errors.push(`${where}: items[${j}]: unknown topic "${it.topic}"`);
    });
  });
  for (const t of L.topics) {
    const ord = tierBySlug.get(t.tier)?.ord;
    if (ord !== undefined && ord > 0 && !L.recipes.some((r) => r.topic === t.slug)) {
      errors.push(`${lf}: topic "${t.slug}" (tier "${t.tier}") has no unlock recipe`);
    }
  }

  // ── questions ──
  unique('question slug', seed.questions.map((q) => q.data.slug), 'questions/');
  const questionSlugs = new Set(seed.questions.map((q) => q.data.slug));
  for (const { file, data: q } of seed.questions) {
    q.topics.forEach((t, i) => {
      if (!topicBySlug.has(t.slug)) errors.push(`${file}: topics[${i}]: unknown topic "${t.slug}"`);
    });
    unique('topic', q.topics.map((t) => t.slug), file);
    checkHints(file, q.hints);
    checkTests(file, q.tests, q.signature.params.length);
    checkGo(`${file}: starter_code.go`, q.starter_code.go);
    if (!q.tests.some((t) => !t.hidden)) warnings.push(`${file}: no visible test, so "Run" has nothing to run`);
  }

  // ── components ──
  unique('component slug', L.components.map((c) => c.slug), lf);
  const componentSlugs = new Set(L.components.map((c) => c.slug));
  L.components.forEach((c, i) => {
    const where = `${lf}: components[${i}] "${c.slug}"`;
    if (!topicBySlug.has(c.topic)) errors.push(`${where}: unknown topic "${c.topic}"`);
    unique('dependency', c.depends_on, where);
    for (const d of c.depends_on) {
      if (d === c.slug) errors.push(`${where}: depends on itself`);
      else if (!componentSlugs.has(d)) errors.push(`${where}: depends_on: unknown component "${d}"`);
    }
    if (c.build_steps.length === 0) warnings.push(`${where}: has no build steps`);
    c.build_steps.forEach((s, j) => {
      const sw = `${where} build_steps[${j}]`;
      checkHints(sw, s.hints);
      if (s.kind !== 'build') return;
      for (const lang of Object.keys(s.payload.starter_code)) {
        if (!(c.languages as string[]).includes(lang)) {
          errors.push(`${sw}: starter_code.${lang}: "${c.slug}" is not built in ${lang}`);
        }
      }
      checkTests(sw, s.payload.tests, c.signature.params.length);
      checkGo(`${sw}: starter_code.go`, s.payload.starter_code.go);
    });
  });
  const cycle = findCycle(
    graphFromEdges(
      L.components.flatMap((c) =>
        c.depends_on.filter((d) => d !== c.slug && componentSlugs.has(d)).map((d) => ({ from: c.slug, dependsOn: d }))
      )
    )
  );
  if (cycle) errors.push(`${lf}: component dependency cycle: ${cycle.join(' → ')}`);

  // ── gates ──
  unique('gate for tier', L.gates.map((g) => g.tier), lf);
  L.gates.forEach((g, i) => {
    const where = `${lf}: gates[${i}] "${g.title}"`;
    const tier = tierBySlug.get(g.tier);
    if (!tier) errors.push(`${where}: unknown tier "${g.tier}"`);
    else if (tier.ord === 0) errors.push(`${where}: the free tier (ord 0) cannot have a gate`);
    unique('question', g.questions, where);
    for (const s of g.questions) {
      if (!questionSlugs.has(s)) errors.push(`${where}: gate question "${s}" is missing from questions/`);
    }
    if (g.pass_threshold > g.questions.length) {
      errors.push(`${where}: pass_threshold ${g.pass_threshold} exceeds its ${g.questions.length} question(s)`);
    }
  });
  for (const t of L.tiers) {
    if (t.ord > 0 && !L.gates.some((g) => g.tier === t.slug)) {
      errors.push(`${lf}: tier "${t.slug}" (ord ${t.ord}) has no gate, so it could never open`);
    }
  }

  // ── unlockability: tokens of a topic are only earned once it is unlocked ──
  const unlockable = new Set(L.topics.filter((t) => tierOrdOf(t.slug) === 0).map((t) => t.slug));
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of L.topics) {
      if (unlockable.has(t.slug)) continue;
      const ok = L.recipes.some((r) => r.topic === t.slug && r.items.every((it) => unlockable.has(it.topic)));
      if (ok) {
        unlockable.add(t.slug);
        changed = true;
      }
    }
  }
  for (const t of L.topics) {
    if (!unlockable.has(t.slug) && L.recipes.some((r) => r.topic === t.slug)) {
      errors.push(
        `${lf}: topic "${t.slug}" can never be unlocked: each of its recipes needs tokens of a topic that is still locked ` +
          '(tokens are only earned from unlocked topics)'
      );
    }
  }

  // ── affordability: can the content pay out enough tokens at all? ──
  // Supply = every token the published questions and build steps can pay
  // (no hint penalties), per topic and source difficulty.
  const supplyRows: { topicId: string; difficulty: Difficulty; amount: number }[] = [];
  for (const { data: q } of seed.questions) {
    if (q.status !== 'published') continue;
    for (const a of solveAward(q.difficulty, q.topics.map((t) => ({ topicId: t.slug, weight: t.weight })), 0)) {
      supplyRows.push({ topicId: a.topicId, difficulty: q.difficulty, amount: a.amount });
    }
  }
  for (const c of L.components) {
    for (const s of c.build_steps) {
      if (s.kind === 'build') supplyRows.push({ topicId: c.topic, difficulty: s.difficulty, amount: buildAward(s.difficulty, 0) });
    }
  }
  const supply = balancesFromRows(supplyRows);
  const cheapestItems: Requirement[] = [];
  for (const t of L.topics) {
    const recipes = L.recipes.filter((r) => r.topic === t.slug);
    if (recipes.length === 0 || !unlockable.has(t.slug)) continue;
    const reqs = recipes.map((r) =>
      r.items.map((it) => ({ topicId: it.topic, quantity: it.quantity, minDifficulty: it.min_difficulty }))
    );
    const affordable = reqs.filter((items) => planDebits(supply, items).ok);
    if (affordable.length === 0) {
      errors.push(
        `${lf}: topic "${t.slug}" can never be unlocked: no recipe fits in the tokens all questions and build steps pay out`
      );
      continue;
    }
    const total = (items: Requirement[]) => items.reduce((n, i) => n + i.quantity, 0);
    cheapestItems.push(...affordable.sort((a, b) => total(a) - total(b))[0]);
  }
  const combined = planDebits(supply, cheapestItems);
  if (!combined.ok) {
    for (const s of combined.shortfalls) {
      warnings.push(
        `${lf}: unlocking every topic (cheapest recipes) needs more "${s.topicId}" tokens (${s.minDifficulty}+) ` +
          'than the content pays out in total'
      );
    }
  }

  // ── badges ──
  if (seed.badges) {
    const bf = seed.badges.file;
    unique('badge slug', seed.badges.data.map((b) => b.slug), bf);
    seed.badges.data.forEach((b, i) => {
      if (b.criteria.kind === 'tier_open' && !L.tiers.some((t) => t.ord === (b.criteria as { tier_ord: number }).tier_ord)) {
        errors.push(`${bf}: badges[${i}] "${b.slug}": no tier has ord ${(b.criteria as { tier_ord: number }).tier_ord}`);
      }
    });
  }

  // ── learn ──
  for (const { file, data: t } of seed.tracks) {
    if (t.tier && !tierBySlug.has(t.tier)) errors.push(`${file}: unknown tier "${t.tier}"`);
    unique('module slug', t.modules.map((m) => m.slug), file);
    unique('lesson slug (lessons are routed per track)', t.modules.flatMap((m) => m.lessons.map((l) => l.slug)), file);
    t.modules.forEach((m, i) =>
      m.lessons.forEach((l, j) => {
        const where = `${file}: modules[${i}].lessons[${j}] "${l.slug}"`;
        if (l.topic && !topicBySlug.has(l.topic)) errors.push(`${where}: unknown topic "${l.topic}"`);
        for (const s of l.related_question_slugs) {
          if (!questionSlugs.has(s)) errors.push(`${where}: related question "${s}" is missing from questions/`);
        }
      })
    );
  }

  // ── library ──
  unique(
    'article slug',
    seed.areas.flatMap((a) => a.data.chapters.flatMap((c) => c.articles.map((x) => x.slug))),
    'library/'
  );
  for (const { file, data: a } of seed.areas) {
    unique('chapter slug', a.chapters.map((c) => c.slug), file);
    a.chapters.forEach((c, i) =>
      c.articles.forEach((x, j) => {
        for (const s of x.practice_question_slugs) {
          if (!questionSlugs.has(s)) {
            errors.push(`${file}: chapters[${i}].articles[${j}] "${x.slug}": practice question "${s}" is missing from questions/`);
          }
        }
      })
    );
  }

  return { errors, warnings };
}
