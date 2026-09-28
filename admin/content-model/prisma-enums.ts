/**
 * Enum values straight from web/prisma/schema.prisma, so the dropdowns in
 * Directus always offer exactly the values Postgres accepts. `@map("x")`
 * renames the database value; comments and block attributes are skipped.
 */
export function parsePrismaEnums(schema: string): Record<string, string[]> {
  const enums: Record<string, string[]> = {};
  for (const block of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = block;
    enums[name] = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line !== '' && !line.startsWith('@@'))
      .map((line) => line.match(/@map\("([^"]+)"\)/)?.[1] ?? line.split(/\s+/)[0]);
  }
  return enums;
}
