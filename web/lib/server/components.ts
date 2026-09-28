import 'server-only';
import type { Language as DbLanguage } from '@prisma/client';
import type { Signature, SupportedLanguage } from '@/lib/types';
import { prisma, type Db } from './db';
import type { TopicRef } from './access';
import { InvalidInput, MissingDependencies, NotFoundError } from './errors';
import { assertAcyclic, dependencyOrder, graphFromEdges, type DepGraph } from './rules/graph';
import { parseJsonColumn, signatureSchema } from './schemas';
import { getUnlockedTopicIds } from './unlocks';

/**
 * Components (My Library) and the build prelude (spec §4): a component's
 * build runs with the learner's latest passing version of every transitive
 * dependency prepended, in topological order, same language.
 */

export interface ComponentNode {
  id: string;
  slug: string;
  title: string;
  ord: number;
  topicId: string;
  languages: SupportedLanguage[];
}

export interface ComponentGraph {
  /** component id → ids it depends on */
  graph: DepGraph;
  nodes: Map<string, ComponentNode>;
}

export interface PassingVersion {
  versionId: string;
  componentId: string;
  language: SupportedLanguage;
  code: string;
  submissionId: string;
  createdAt: Date;
}

export interface Prelude {
  /** Dependency sources in build order — the compile service's `prelude`. */
  prelude: string[];
  dependencies: { componentId: string; slug: string; versionId: string }[];
}

/** The whole dependency graph (small: one row per component and edge). Throws DependencyCycle. */
export async function loadComponentGraph(db: Db = prisma): Promise<ComponentGraph> {
  const [components, edges] = await Promise.all([
    db.component.findMany({
      select: { id: true, slug: true, title: true, ord: true, topicId: true, languages: true },
    }),
    db.componentDep.findMany({ select: { componentId: true, dependsOnId: true } }),
  ]);
  const graph = graphFromEdges(
    edges.map((e) => ({ from: e.componentId, dependsOn: e.dependsOnId })),
    components.map((c) => c.id)
  );
  assertAcyclic(graph);
  return { graph, nodes: new Map(components.map((c) => [c.id, c])) };
}

/** `componentId`'s transitive dependencies in build order (dependencies first). */
export async function getDependencyOrder(componentId: string, db: Db = prisma): Promise<ComponentNode[]> {
  const { graph, nodes } = await loadComponentGraph(db);
  if (!nodes.has(componentId)) throw new NotFoundError('component', componentId);
  return dependencyOrder(graph, componentId, (id) => nodes.get(id)?.ord ?? 0).map((id) => nodes.get(id)!);
}

/** Latest passing version per component (among `componentIds`) in one language. */
export async function latestPassingVersions(
  userId: string,
  componentIds: string[],
  language: SupportedLanguage,
  db: Db = prisma
): Promise<Map<string, PassingVersion>> {
  if (componentIds.length === 0) return new Map();
  const rows = await db.componentVersion.findMany({
    where: { userId, componentId: { in: componentIds }, language, passed: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    distinct: ['componentId'],
    select: { id: true, componentId: true, language: true, code: true, submissionId: true, createdAt: true },
  });
  return new Map(
    rows.map((r) => [
      r.componentId,
      {
        versionId: r.id,
        componentId: r.componentId,
        language: r.language,
        code: r.code,
        submissionId: r.submissionId,
        createdAt: r.createdAt,
      },
    ])
  );
}

/** The user's latest passing version of one component in one language, or null. */
export async function latestPassingVersion(
  userId: string,
  componentId: string,
  language: SupportedLanguage,
  db: Db = prisma
): Promise<PassingVersion | null> {
  return (await latestPassingVersions(userId, [componentId], language, db)).get(componentId) ?? null;
}

/**
 * The prelude for building `componentId` in `language`: the latest passing
 * version of every transitive dependency, dependencies first. Throws
 * MissingDependencies (→ HTTP 409 `{missing: [slug]}`) listing, in build
 * order, every dependency without a passing version in that language.
 * Also throws NotFoundError, InvalidInput (language not offered),
 * DependencyCycle (bad content).
 */
export async function assemblePrelude(
  userId: string,
  componentId: string,
  language: SupportedLanguage,
  db: Db = prisma
): Promise<Prelude> {
  const { graph, nodes } = await loadComponentGraph(db);
  const node = nodes.get(componentId);
  if (!node) throw new NotFoundError('component', componentId);
  if (!node.languages.includes(language)) {
    throw new InvalidInput(`${node.slug} cannot be built in ${language}`);
  }
  const order = dependencyOrder(graph, componentId, (id) => nodes.get(id)?.ord ?? 0);
  const versions = await latestPassingVersions(userId, order, language, db);
  const missing = order.filter((id) => !versions.has(id)).map((id) => nodes.get(id)!.slug);
  if (missing.length > 0) throw new MissingDependencies(missing);
  return {
    prelude: order.map((id) => versions.get(id)!.code),
    dependencies: order.map((id) => ({
      componentId: id,
      slug: nodes.get(id)!.slug,
      versionId: versions.get(id)!.versionId,
    })),
  };
}

/** Persist the code of a `build` submission as a component version. Idempotent per submission. */
export async function recordComponentVersion(
  input: {
    userId: string;
    componentId: string;
    language: DbLanguage;
    code: string;
    passed: boolean;
    submissionId: string;
  },
  db: Db = prisma
): Promise<{ id: string }> {
  return db.componentVersion.upsert({
    where: { submissionId: input.submissionId },
    create: input,
    update: { passed: input.passed },
    select: { id: true },
  });
}

// ─── My Library (T3) ─────────────────────────────────────────────────────

export interface LibraryComponent {
  id: string;
  slug: string;
  title: string;
  summaryMd: string;
  functionName: string;
  signature: Signature;
  languages: SupportedLanguage[];
  ord: number;
  topic: TopicRef & { unlocked: boolean };
  dependsOn: { id: string; slug: string; title: string }[];
  /** Latest passing version per language the user has built. */
  versions: Partial<Record<SupportedLanguage, { versionId: string; createdAt: Date; code: string }>>;
  /** Build-kind steps passed / total. */
  steps: { passed: number; total: number };
  built: boolean;
}

/** Every component with the user's progress, in map order (tier → topic → component). */
export async function getLibrary(userId: string): Promise<LibraryComponent[]> {
  const [components, versions, passedSteps, unlocked] = await Promise.all([
    prisma.component.findMany({
      select: {
        id: true,
        slug: true,
        title: true,
        summaryMd: true,
        functionName: true,
        signature: true,
        languages: true,
        ord: true,
        topic: { select: { id: true, slug: true, title: true, icon: true, ord: true, tier: { select: { ord: true } } } },
        deps: { select: { dependsOn: { select: { id: true, slug: true, title: true } } } },
        buildSteps: { where: { kind: 'build' }, select: { id: true } },
      },
    }),
    prisma.componentVersion.findMany({
      where: { userId, passed: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['componentId', 'language'],
      select: { id: true, componentId: true, language: true, code: true, createdAt: true },
    }),
    prisma.stepProgress.findMany({ where: { userId, status: 'passed' }, select: { buildStepId: true } }),
    getUnlockedTopicIds(userId),
  ]);
  const passed = new Set(passedSteps.map((s) => s.buildStepId));
  return components
    .sort((a, b) => a.topic.tier.ord - b.topic.tier.ord || a.topic.ord - b.topic.ord || a.ord - b.ord)
    .map((c) => {
      const mine = versions.filter((v) => v.componentId === c.id);
      const { tier: _tier, ord: _ord, ...topic } = c.topic;
      return {
        id: c.id,
        slug: c.slug,
        title: c.title,
        summaryMd: c.summaryMd,
        functionName: c.functionName,
        signature: parseJsonColumn(signatureSchema, c.signature, `components.signature (${c.slug})`),
        languages: c.languages,
        ord: c.ord,
        topic: { ...topic, unlocked: unlocked.has(c.topic.id) },
        dependsOn: c.deps.map((d) => d.dependsOn),
        versions: Object.fromEntries(
          mine.map((v) => [v.language, { versionId: v.id, createdAt: v.createdAt, code: v.code }])
        ),
        steps: { passed: c.buildSteps.filter((s) => passed.has(s.id)).length, total: c.buildSteps.length },
        built: mine.length > 0,
      };
    });
}
