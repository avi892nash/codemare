// esbuild bundles web/prisma/schema.prisma as a string (--loader:.prisma=text).
declare module '*.prisma' {
  const text: string;
  export default text;
}
