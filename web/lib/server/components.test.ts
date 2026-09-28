import { describe, expect, it } from 'vitest';
import type { SupportedLanguage } from '@/lib/types';
import { assemblePrelude, getDependencyOrder, getLibrary, latestPassingVersion } from './components';
import { DependencyCycle, InvalidInput, MissingDependencies } from './errors';
import { prisma, setupTestDatabase } from './test/db';
import { makeBuildStep, makeComponent, makeSubmission, makeTier, makeTopic, makeUser } from './test/factories';

setupTestDatabase();

/** swap ← heap ← dijkstra → graph (dijkstra depends on heap and graph; heap on swap). */
async function library() {
  const tier = await makeTier(0);
  const topic = await makeTopic(tier.id, { slug: 'heaps' });
  const swap = await makeComponent({ topicId: topic.id, slug: 'swap', ord: 0 });
  const heap = await makeComponent({ topicId: topic.id, slug: 'heap', ord: 1, dependsOn: [swap.id] });
  const graph = await makeComponent({ topicId: topic.id, slug: 'graph', ord: 2 });
  const dijkstra = await makeComponent({
    topicId: topic.id,
    slug: 'dijkstra',
    ord: 3,
    dependsOn: [heap.id, graph.id],
    languages: ['python', 'javascript', 'cpp'],
  });
  return { topic, swap, heap, graph, dijkstra };
}

async function version(
  userId: string,
  componentId: string,
  code: string,
  opts: { passed?: boolean; language?: SupportedLanguage; createdAt?: Date } = {}
) {
  const sub = await makeSubmission(userId, { kind: 'build', language: opts.language ?? 'python', code });
  return prisma.componentVersion.create({
    data: {
      userId,
      componentId,
      language: opts.language ?? 'python',
      code,
      passed: opts.passed ?? true,
      submissionId: sub.id,
      createdAt: opts.createdAt,
    },
  });
}

describe('assemblePrelude', () => {
  it('concatenates the latest passing version of every transitive dependency, deps first', async () => {
    const lib = await library();
    const user = await makeUser();
    await version(user.id, lib.swap.id, 'def swap(): pass');
    await version(user.id, lib.heap.id, 'def heap_old(): pass', { createdAt: new Date('2026-01-01') });
    await version(user.id, lib.heap.id, 'def heap(): pass', { createdAt: new Date('2026-01-02') });
    await version(user.id, lib.heap.id, 'def heap_broken(): pass', { passed: false, createdAt: new Date('2026-01-03') });
    await version(user.id, lib.graph.id, 'def graph(): pass');
    await version(user.id, lib.graph.id, 'function graph() {}', { language: 'javascript' });

    const r = await assemblePrelude(user.id, lib.dijkstra.id, 'python');
    expect(r.prelude).toEqual(['def swap(): pass', 'def heap(): pass', 'def graph(): pass']);
    expect(r.dependencies.map((d) => d.slug)).toEqual(['swap', 'heap', 'graph']);
  });

  it('is empty for a component without dependencies', async () => {
    const lib = await library();
    const user = await makeUser();
    expect(await assemblePrelude(user.id, lib.swap.id, 'python')).toEqual({ prelude: [], dependencies: [] });
  });

  it('throws MissingDependencies listing every unbuilt dependency in build order', async () => {
    const lib = await library();
    const user = await makeUser();
    await version(user.id, lib.heap.id, 'def heap(): pass');
    await version(user.id, lib.graph.id, 'def graph(): pass', { passed: false });
    await version(user.id, lib.swap.id, 'function swap() {}', { language: 'javascript' });

    const err = await assemblePrelude(user.id, lib.dijkstra.id, 'python').catch((e) => e);
    expect(err).toBeInstanceOf(MissingDependencies);
    expect((err as MissingDependencies).missing).toEqual(['swap', 'graph']);
    expect((err as MissingDependencies).status).toBe(409);
    expect((err as MissingDependencies).toJSON()).toMatchObject({ missing: ['swap', 'graph'] });
  });

  it('refuses a language the component does not offer', async () => {
    const lib = await library();
    const user = await makeUser();
    await expect(assemblePrelude(user.id, lib.heap.id, 'go')).rejects.toBeInstanceOf(InvalidInput);
  });

  it('detects a cycle introduced behind the seed’s back', async () => {
    const lib = await library();
    const user = await makeUser();
    await prisma.componentDep.create({ data: { componentId: lib.swap.id, dependsOnId: lib.dijkstra.id } });
    await expect(assemblePrelude(user.id, lib.dijkstra.id, 'python')).rejects.toBeInstanceOf(DependencyCycle);
    await expect(getDependencyOrder(lib.heap.id)).rejects.toBeInstanceOf(DependencyCycle);
  });
});

describe('versions and the library', () => {
  it('finds the latest passing version per language', async () => {
    const lib = await library();
    const user = await makeUser();
    expect(await latestPassingVersion(user.id, lib.swap.id, 'python')).toBeNull();
    await version(user.id, lib.swap.id, 'a', { createdAt: new Date('2026-01-01') });
    await version(user.id, lib.swap.id, 'b', { createdAt: new Date('2026-01-05') });
    await version(user.id, lib.swap.id, 'c', { createdAt: new Date('2026-01-09'), passed: false });
    expect((await latestPassingVersion(user.id, lib.swap.id, 'python'))?.code).toBe('b');
  });

  it('lists every component with deps, versions and step progress', async () => {
    const lib = await library();
    const user = await makeUser();
    const step = await makeBuildStep(lib.heap.id);
    await makeBuildStep(lib.heap.id, { ord: 1 });
    await prisma.stepProgress.create({ data: { userId: user.id, buildStepId: step.id, status: 'passed' } });
    await version(user.id, lib.heap.id, 'def heap(): pass');

    const all = await getLibrary(user.id);
    expect(all.map((c) => c.slug)).toEqual(['swap', 'heap', 'graph', 'dijkstra']);
    const heap = all[1];
    expect(heap).toMatchObject({
      built: true,
      steps: { passed: 1, total: 2 },
      dependsOn: [{ slug: 'swap' }],
      topic: { slug: 'heaps', unlocked: true },
      signature: { params: [], returns: 'int' },
    });
    expect(heap.versions.python?.code).toBe('def heap(): pass');
    expect(all[0]).toMatchObject({ built: false, versions: {} });
  });
});
