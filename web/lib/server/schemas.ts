/**
 * zod schemas for the JSON columns of spec §2.1. Used by the seed to
 * validate content files and by services to parse JSON columns read back
 * from Postgres. Pure: safe to import from anywhere.
 *
 * Each schema's output type is checked against its lib/types.ts twin at the
 * bottom of the file, so the two cannot drift apart.
 */
import { z } from 'zod';
import {
  DIFFICULTIES,
  LANGUAGES,
  SIGNATURE_BASE_TYPES,
  type BadgeCriteria,
  type Example,
  type Signature,
  type SignatureType,
  type TestDef,
} from '@/lib/types';

/** Any JSON value (no `undefined`, functions, dates …). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

export const difficultySchema = z.enum(DIFFICULTIES);
export const languageSchema = z.enum(LANGUAGES);
export const compareModeSchema = z.enum(['ordered', 'unordered']);

const SIGNATURE_TYPE_RE = new RegExp(`^(${SIGNATURE_BASE_TYPES.join('|')})(\\[\\]){0,2}$`);
export const signatureTypeSchema = z.custom<SignatureType>(
  (v) => typeof v === 'string' && SIGNATURE_TYPE_RE.test(v),
  { message: `expected ${SIGNATURE_BASE_TYPES.join('|')} with up to two [] suffixes` }
);

export const identifierSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'expected an identifier');

export const signatureSchema = z
  .object({
    params: z.array(z.object({ name: identifierSchema, type: signatureTypeSchema }).strict()),
    returns: signatureTypeSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const names = s.params.map((p) => p.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) ctx.addIssue({ code: 'custom', message: `duplicate parameter "${dup}"`, path: ['params'] });
  });

export const testDefSchema = z
  .object({
    input: z.array(jsonValueSchema),
    expected: jsonValueSchema,
    hidden: z.boolean(),
    explain_on_fail: z.string().min(1).optional(),
  })
  .strict();

export const exampleSchema = z
  .object({
    input: z.string(),
    output: z.string(),
    explanation: z.string().optional(),
  })
  .strict();

/** `Partial<Record<Language, string>>` — unknown language keys are rejected. */
export const codeByLanguageSchema = z.record(languageSchema, z.string());

const count = z.number().int().positive();
export const badgeCriteriaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first_accept') }).strict(),
  z.object({ kind: z.literal('solves'), n: count }).strict(),
  z.object({ kind: z.literal('solves_difficulty'), difficulty: difficultySchema, n: count }).strict(),
  z.object({ kind: z.literal('streak_days'), n: count }).strict(),
  z.object({ kind: z.literal('no_hint_solves'), n: count }).strict(),
  z.object({ kind: z.literal('topics_unlocked'), n: count }).strict(),
  z.object({ kind: z.literal('tier_open'), tier_ord: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('gate_first_try') }).strict(),
  z.object({ kind: z.literal('lessons_completed'), n: count }).strict(),
  z.object({ kind: z.literal('track_completed') }).strict(),
  z.object({ kind: z.literal('fast_solve'), percentile: z.number().min(0).max(100) }).strict(),
]);

// ─── Runtime parsing helpers for JSON columns ────────────────────────────

/** Parse a JSON column or throw a descriptive error (bad content is a bug, not user error). */
export function parseJsonColumn<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new Error(`invalid ${what}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return r.data;
}

// ─── Drift guard: schema outputs must satisfy the lib/types shapes ────────

type Assert<T extends true> = T;
type Satisfies<A, B> = A extends B ? true : false;
export type __SchemaTypeChecks = [
  Assert<Satisfies<z.infer<typeof signatureSchema>, Signature>>,
  Assert<Satisfies<z.infer<typeof testDefSchema>, TestDef>>,
  Assert<Satisfies<z.infer<typeof exampleSchema>, Example>>,
  Assert<Satisfies<z.infer<typeof badgeCriteriaSchema>, BadgeCriteria>>,
];
