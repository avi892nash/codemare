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
