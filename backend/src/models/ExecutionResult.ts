/** Every language the compile service accepts. */
export type Language = 'python' | 'javascript' | 'typescript' | 'cpp' | 'java' | 'go';

export const LANGUAGES: readonly Language[] = [
  'python',
  'javascript',
  'typescript',
  'cpp',
  'java',
  'go',
];

/**
 * Languages the sandbox executes directly. TypeScript never reaches the
 * sandbox: it is transpiled to JavaScript in the API process (see
 * services/typescript.ts) and then runs as 'javascript'.
 */
export type SandboxLanguage = Exclude<Language, 'typescript'>;
