/**
 * Apply the content model (model.ts) to a running Directus — idempotently,
 * through the REST API, META ONLY: it never sends a `schema` object, so
 * Directus never issues DDL (and the directus database role could not run
 * any on content.* anyway). Safe to run on every deploy; unchanged entries
 * are skipped, so a re-run writes nothing. The only deletes are the meta and
 * permissions of retired collections whose tables are already gone.
 *
 *   DIRECTUS_URL                 default http://localhost:8055
 *   DIRECTUS_ADMIN_EMAIL/PASSWORD  an admin login, or
 *   DIRECTUS_TOKEN               an admin static token
 *
 * Run by the `directus-config` compose service (node /codemare/apply-content-model.mjs)
 * or locally from admin/: `npm run apply`.
 */
import { Directus, DirectusError } from './directus';
import {
  COLLECTIONS,
  CONTENT_EDITOR,
  DEFAULT_MODULE_BAR,
  FOLDERS,
  MODULE,
  PROJECT_SETTINGS,
  RELATIONS,
  RETIRED_COLLECTIONS,
} from './model';

type Json = Record<string, unknown>;

interface FieldRow {
  field: string;
  type: string;
  meta: Json | null;
  schema: Json | null;
}

const stats = { changed: 0, unchanged: 0, warnings: [] as string[] };

/** Deep "every key of `want` equals the same key in `have`". */
function covers(have: unknown, want: unknown): boolean {
  if (want === null || typeof want !== 'object') return have === want || (want === null && have === undefined);
  if (Array.isArray(want)) {
    return Array.isArray(have) && have.length === want.length && want.every((w, i) => covers(have[i], w));
  }
  if (have === null || typeof have !== 'object') return false;
  return Object.entries(want as Json).every(([k, v]) => covers((have as Json)[k], v));
}

function note(changed: boolean, what: string) {
  if (changed) {
    stats.changed++;
    console.log(`  ~ ${what}`);
  } else {
    stats.unchanged++;
  }
}

/**
 * Collections whose tables a migration dropped (RETIRED_COLLECTIONS): delete
 * every permission on them, then their collection meta, so they leave the
 * data studio and the policies. Only once the table is gone — a retired
 * collection that still has its table is reported and left alone, and
 * deleting meta-only collections never issues DDL.
 */
async function applyRetired(dx: Directus) {
  for (const collection of RETIRED_COLLECTIONS) {
    const existing = await dx.find<{ schema: Json | null }>(`/collections/${collection}`);
    if (existing?.schema) {
      stats.warnings.push(`table content.${collection} still exists (migrations not applied yet?) — its Directus meta is kept`);
      continue;
    }
    const filter = encodeURIComponent(JSON.stringify({ collection: { _eq: collection } }));
    const permissions = await dx.get<{ id: number | string }[]>(`/permissions?filter=${filter}&fields=id&limit=-1`);
    if (permissions.length > 0) {
      await dx.delete('/permissions', permissions.map((p) => p.id));
      note(true, `${permissions.length} permissions on retired ${collection} deleted`);
    }
    if (existing) {
      await dx.delete(`/collections/${collection}`);
      note(true, `retired collection ${collection} deleted (meta only)`);
    } else if (permissions.length === 0) note(false, '');
  }
}

async function applyFolders(dx: Directus) {
  for (const folder of FOLDERS) {
    const existing = await dx.find<{ meta: Json | null; schema: Json | null }>(`/collections/${folder.collection}`);
    if (!existing) {
      await dx.post('/collections', { collection: folder.collection, meta: folder.meta, schema: null });
      note(true, `folder ${folder.collection} created`);
    } else if (existing.schema) {
      stats.warnings.push(`${folder.collection} exists as a real table; not using it as a folder`);
    } else if (!covers(existing.meta, folder.meta)) {
      await dx.patch(`/collections/${folder.collection}`, { meta: folder.meta });
      note(true, `folder ${folder.collection} updated`);
    } else note(false, '');
  }
}

async function applyCollections(dx: Directus) {
  for (const spec of COLLECTIONS) {
    const existing = await dx.find<{ meta: Json | null; schema: Json | null }>(`/collections/${spec.collection}`);
    if (!existing?.schema) {
      stats.warnings.push(`table content.${spec.collection} not found (migrations not applied yet?) — skipped`);
      continue;
    }
    if (!covers(existing.meta, spec.meta)) {
      await dx.patch(`/collections/${spec.collection}`, { meta: spec.meta });
      note(true, `collection ${spec.collection}`);
    } else note(false, '');

    const fields = await dx.get<FieldRow[]>(`/fields/${spec.collection}`);
    const byName = new Map(fields.map((f) => [f.field, f]));
    for (const f of spec.fields) {
      const current = byName.get(f.field);
      if (f.alias) {
        if (!current) {
          await dx.post(`/fields/${spec.collection}`, { field: f.field, type: 'alias', meta: f.meta });
          note(true, `alias ${spec.collection}.${f.field} created`);
        } else if (!covers(current.meta, f.meta)) {
          await dx.patch(`/fields/${spec.collection}/${f.field}`, { meta: f.meta });
          note(true, `alias ${spec.collection}.${f.field}`);
        } else note(false, '');
        continue;
      }
      if (!current?.schema) {
        stats.warnings.push(`column content.${spec.collection}.${f.field} not found — skipped (model ahead of migrations?)`);
        continue;
      }
      if (!covers(current.meta, f.meta)) {
        // meta only: no `type`, no `schema`, hence no ALTER TABLE.
        await dx.patch(`/fields/${spec.collection}/${f.field}`, { meta: f.meta });
        note(true, `field ${spec.collection}.${f.field}`);
      } else note(false, '');
    }
    const described = new Set(spec.fields.map((f) => f.field));
    for (const f of fields) {
      if (f.schema && !described.has(f.field)) {
        stats.warnings.push(
          `column content.${spec.collection}.${f.field} is not in admin/content-model/model.ts (new migration?) — it keeps Directus defaults`
        );
      }
    }
  }
}

async function applyRelations(dx: Directus) {
  for (const rel of RELATIONS) {
    const current = await dx.find<{ meta: Json | null; schema: Json | null }>(`/relations/${rel.collection}/${rel.field}`);
    if (!current?.schema) {
      stats.warnings.push(`foreign key ${rel.collection}.${rel.field} not found — relation skipped`);
      continue;
    }
    if (!covers(current.meta, rel.meta)) {
      await dx.patch(`/relations/${rel.collection}/${rel.field}`, { meta: rel.meta });
      note(true, `relation ${rel.collection}.${rel.field}`);
    } else note(false, '');
  }
}

async function applyAccess(dx: Directus) {
  const q = encodeURIComponent;
  const { policy: policySpec, role: roleSpec, collections, actions } = CONTENT_EDITOR;

  let policy = (await dx.get<Json[]>(`/policies?filter[name][_eq]=${q(policySpec.name)}&limit=1`))[0] as
    | { id: string }
    | undefined;
  if (!policy) {
    policy = await dx.post<{ id: string }>('/policies', policySpec);
    note(true, `policy "${policySpec.name}" created`);
  }

  const existing = await dx.get<{ collection: string; action: string }[]>(
    `/permissions?filter[policy][_eq]=${q(policy.id)}&fields=collection,action&limit=-1`
  );
  const have = new Set(existing.map((p) => `${p.collection}:${p.action}`));
  const missing = collections.flatMap((collection) =>
    actions
      .filter((action) => !have.has(`${collection}:${action}`))
      .map((action) => ({ policy: policy!.id, collection, action, fields: ['*'], permissions: {}, validation: {} }))
  );
  if (missing.length > 0) {
    await dx.post('/permissions', missing);
    note(true, `${missing.length} permissions granted to "${policySpec.name}"`);
  } else note(false, '');

  let role = (await dx.get<Json[]>(`/roles?filter[name][_eq]=${q(roleSpec.name)}&limit=1`))[0] as { id: string } | undefined;
  if (!role) {
    role = await dx.post<{ id: string }>('/roles', roleSpec);
    note(true, `role "${roleSpec.name}" created`);
  }
  const links = await dx.get<Json[]>(
    `/access?filter[role][_eq]=${q(role.id)}&filter[policy][_eq]=${q(policy.id)}&limit=1`
  );
  if (links.length === 0) {
    await dx.post('/access', { role: role.id, policy: policy.id });
    note(true, `role "${roleSpec.name}" linked to its policy`);
  } else note(false, '');
}

async function applySettings(dx: Directus) {
  const settings = await dx.get<{ module_bar: Json[] | null } & Json>(
    '/settings?fields=project_name,project_descriptor,project_color,module_bar'
  );
  const patch: Json = {};
  for (const [k, v] of Object.entries(PROJECT_SETTINGS)) if (settings[k] !== v) patch[k] = v;

  const bar = (settings.module_bar ?? DEFAULT_MODULE_BAR).map((m) => ({ ...m }));
  if (!bar.some((m) => m.id === MODULE.id)) {
    const at = bar.findIndex((m) => m.id === MODULE.after);
    bar.splice(at >= 0 ? at + 1 : 0, 0, { type: 'module', id: MODULE.id, enabled: true });
    patch.module_bar = bar;
  }
  if (Object.keys(patch).length > 0) {
    await dx.patch('/settings', patch);
    note(true, `settings: ${Object.keys(patch).join(', ')}`);
  } else note(false, '');
}

async function main() {
  const url = (process.env.DIRECTUS_URL ?? 'http://localhost:8055').replace(/\/$/, '');
  const dx = new Directus(url);
  console.log(`content model → ${url}`);
  await dx.waitUntilHealthy();
  if (process.env.DIRECTUS_TOKEN) dx.useToken(process.env.DIRECTUS_TOKEN);
  else {
    const email = process.env.DIRECTUS_ADMIN_EMAIL;
    const password = process.env.DIRECTUS_ADMIN_PASSWORD;
    if (!email || !password) throw new Error('set DIRECTUS_ADMIN_EMAIL and DIRECTUS_ADMIN_PASSWORD (or DIRECTUS_TOKEN)');
    await dx.login(email, password);
  }

  // Prisma migrations change content.* behind Directus' back; drop its cached
  // schema first so this run (and the data studio) see the current tables.
  await dx.post('/utils/cache/clear?system', {});

  await applyRetired(dx);
  await applyFolders(dx);
  await applyCollections(dx);
  await applyRelations(dx);
  await applyAccess(dx);
  await applySettings(dx);
  await dx.post('/utils/cache/clear?system', {});

  for (const w of stats.warnings) console.warn(`  ! ${w}`);
  console.log(`content model applied: ${stats.changed} changed, ${stats.unchanged} unchanged, ${stats.warnings.length} warnings`);
}

main().catch((error) => {
  console.error(error instanceof DirectusError ? `apply-content-model: ${error.message}` : error);
  process.exit(1);
});
