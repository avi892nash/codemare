import { IdePersistedState, LanguageData } from '../types/storage';
import { Language } from '../types/execution';

const STORAGE_KEY = 'codemare_ide_state';
const STORAGE_VERSION = 1;

/**
 * Validate if the loaded data matches the expected structure
 */
function isValidIdeState(data: any): data is IdePersistedState {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (!data.lastUsedLanguage || typeof data.lastUsedLanguage !== 'string') return false;
  if (!data.languageData || typeof data.languageData !== 'object') return false;

  // Validate each language data structure
  const languages: Language[] = ['python', 'javascript', 'cpp', 'java'];
  for (const lang of languages) {
    const langData = data.languageData[lang];
    if (langData) {
      if (typeof langData.code !== 'string') return false;
      if (!Array.isArray(langData.testCases)) return false;
      if (typeof langData.lastModified !== 'number') return false;
    }
  }

  return true;
}

/**
 * Create an empty IDE state with initial structure
 */
export function createEmptyState(): IdePersistedState {
  return {
    version: STORAGE_VERSION,
    lastUsedLanguage: 'python',
    languageData: {
      python: { code: '', testCases: [], lastModified: 0 },
      javascript: { code: '', testCases: [], lastModified: 0 },
      cpp: { code: '', testCases: [], lastModified: 0 },
      java: { code: '', testCases: [], lastModified: 0 },
    },
  };
}

/**
 * Load IDE state from localStorage
 * Returns null if no data exists, data is corrupted, or localStorage is unavailable
 */
export function loadIdeState(): IdePersistedState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    if (!isValidIdeState(parsed)) {
      console.error('Invalid IDE state structure, clearing storage');
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Error loading IDE state from localStorage:', error);
    // Clear corrupted data
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore errors when clearing
    }
    return null;
  }
}

/**
 * Save IDE state to localStorage
 * Returns true if successful, false otherwise
 */
export function saveIdeState(state: IdePersistedState): boolean {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded. Unable to save IDE state.');
    } else {
      console.error('Error saving IDE state to localStorage:', error);
    }
    return false;
  }
}

/**
 * Clear all IDE data from localStorage
 */
export function clearIdeState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing IDE state from localStorage:', error);
  }
}

/**
 * Clear data for a specific language
 */
export function clearLanguageData(language: Language): boolean {
  try {
    const state = loadIdeState();
    if (!state) return false;

    // Reset the language data to empty
    state.languageData[language] = {
      code: '',
      testCases: [],
      lastModified: 0,
    };

    return saveIdeState(state);
  } catch (error) {
    console.error(`Error clearing data for language ${language}:`, error);
    return false;
  }
}

/**
 * Get data for a specific language
 */
export function getLanguageData(language: Language): LanguageData | null {
  try {
    const state = loadIdeState();
    if (!state) return null;

    const langData = state.languageData[language];
    // Return data only if it has actual content (not empty initial state)
    if (langData && (langData.code || langData.testCases.length > 0)) {
      return langData;
    }

    return null;
  } catch (error) {
    console.error(`Error getting data for language ${language}:`, error);
    return null;
  }
}
