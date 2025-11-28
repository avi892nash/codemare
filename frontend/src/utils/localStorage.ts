import { IdePersistedState, LanguageData, AppPersistedState } from '../types/storage';
import { Language } from '../types/execution';

const IDE_STORAGE_KEY = 'codemare_ide_state';
const APP_STORAGE_KEY = 'codemare_app_state';
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
    const stored = localStorage.getItem(IDE_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    if (!isValidIdeState(parsed)) {
      console.error('Invalid IDE state structure, clearing storage');
      localStorage.removeItem(IDE_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Error loading IDE state from localStorage:', error);
    // Clear corrupted data
    try {
      localStorage.removeItem(IDE_STORAGE_KEY);
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
    localStorage.setItem(IDE_STORAGE_KEY, serialized);
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
    localStorage.removeItem(IDE_STORAGE_KEY);
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

// ============================================================================
// App State Persistence (mode, language, problem, problem code)
// ============================================================================

/**
 * Validate app state structure
 */
function isValidAppState(data: any): data is AppPersistedState {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (!data.mode || (data.mode !== 'problem' && data.mode !== 'ide')) return false;
  if (!data.selectedLanguage || typeof data.selectedLanguage !== 'string') return false;
  if (data.currentProblemId !== null && typeof data.currentProblemId !== 'string') return false;
  if (!data.problemCode || typeof data.problemCode !== 'object') return false;
  return true;
}

/**
 * Create empty app state
 */
export function createEmptyAppState(): AppPersistedState {
  return {
    version: STORAGE_VERSION,
    mode: 'problem',
    selectedLanguage: 'python',
    currentProblemId: null,
    problemCode: {},
  };
}

/**
 * Load app state from localStorage
 */
export function loadAppState(): AppPersistedState | null {
  try {
    const stored = localStorage.getItem(APP_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    if (!isValidAppState(parsed)) {
      console.error('Invalid app state structure, clearing storage');
      localStorage.removeItem(APP_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Error loading app state from localStorage:', error);
    try {
      localStorage.removeItem(APP_STORAGE_KEY);
    } catch {
      // Ignore errors when clearing
    }
    return null;
  }
}

/**
 * Save app state to localStorage
 */
export function saveAppState(state: AppPersistedState): boolean {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(APP_STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded. Unable to save app state.');
    } else {
      console.error('Error saving app state to localStorage:', error);
    }
    return false;
  }
}

/**
 * Save problem code for a specific problem/language combination
 */
export function saveProblemCode(problemId: string, language: Language, code: string): boolean {
  try {
    const state = loadAppState() || createEmptyAppState();

    if (!state.problemCode[problemId]) {
      state.problemCode[problemId] = {};
    }

    state.problemCode[problemId][language] = code;
    return saveAppState(state);
  } catch (error) {
    console.error('Error saving problem code:', error);
    return false;
  }
}

/**
 * Get problem code for a specific problem/language combination
 */
export function getProblemCode(problemId: string, language: Language): string | null {
  try {
    const state = loadAppState();
    if (!state) return null;

    return state.problemCode[problemId]?.[language] || null;
  } catch (error) {
    console.error('Error getting problem code:', error);
    return null;
  }
}
