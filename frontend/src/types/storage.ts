import { Language, IdeTestCase } from './execution';

export interface LanguageData {
  code: string;
  testCases: IdeTestCase[];
  lastModified: number;
}

export interface IdePersistedState {
  version: number;
  lastUsedLanguage: Language;
  languageData: {
    python: LanguageData;
    javascript: LanguageData;
    cpp: LanguageData;
    java: LanguageData;
  };
}

// App-level state persistence
export type Mode = 'problem' | 'ide';

export interface ProblemCodeData {
  [problemId: string]: {
    [language: string]: string; // code for each language
  };
}

export interface AppPersistedState {
  version: number;
  mode: Mode;
  selectedLanguage: Language;
  currentProblemId: string | null;
  problemCode: ProblemCodeData;
}
