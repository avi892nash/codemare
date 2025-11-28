import { useEffect, useRef } from 'react';
import { Language, IdeTestCase } from '../types/execution';
import {
  loadIdeState,
  saveIdeState,
  createEmptyState,
} from '../utils/localStorage';
import { IDE_TEMPLATES } from '../constants/ideTemplates';

type Mode = 'problem' | 'ide';

const DEFAULT_TEST_CASE: IdeTestCase = {
  input: '2\n3',
  expectedOutput: '5',
};

/**
 * Custom hook to persist IDE code and test cases in localStorage
 * Handles auto-save with debouncing, language switching, and restoration
 */
export function useIdePersistence(
  selectedLanguage: Language,
  code: string,
  setCode: (code: string) => void,
  testCases: IdeTestCase[],
  setTestCases: (testCases: IdeTestCase[]) => void,
  mode: Mode
): void {
  const prevLanguageRef = useRef<Language>(selectedLanguage);
  const hasHydratedRef = useRef(false);

  // Effect 1: Hydration - Load persisted data when entering IDE mode
  useEffect(() => {
    if (mode === 'ide' && !hasHydratedRef.current) {
      const savedState = loadIdeState();

      if (savedState) {
        const languageData = savedState.languageData[selectedLanguage];

        // Only restore if the language has saved data with actual content
        if (languageData && (languageData.code || languageData.testCases.length > 0)) {
          setCode(languageData.code);
          setTestCases(
            languageData.testCases.length > 0
              ? languageData.testCases
              : [DEFAULT_TEST_CASE]
          );
        } else {
          // Use template for this language
          setCode(IDE_TEMPLATES[selectedLanguage]);
          setTestCases([DEFAULT_TEST_CASE]);
        }
      } else {
        // First visit - use template
        setCode(IDE_TEMPLATES[selectedLanguage]);
        setTestCases([DEFAULT_TEST_CASE]);
      }

      hasHydratedRef.current = true;
    }

    // Reset hydration flag when leaving IDE mode
    if (mode !== 'ide') {
      hasHydratedRef.current = false;
    }
  }, [mode, selectedLanguage, setCode, setTestCases]);

  // Effect 2: Debounced Save - Save changes after 500ms of inactivity
  useEffect(() => {
    if (mode !== 'ide' || !hasHydratedRef.current) return;

    const timeoutId = setTimeout(() => {
      const currentState = loadIdeState() || createEmptyState();

      currentState.languageData[selectedLanguage] = {
        code,
        testCases,
        lastModified: Date.now(),
      };
      currentState.lastUsedLanguage = selectedLanguage;

      saveIdeState(currentState);
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [code, testCases, selectedLanguage, mode]);

  // Effect 3: Language Switch - Immediate save current, restore new
  useEffect(() => {
    if (mode !== 'ide' || !hasHydratedRef.current) return;

    if (prevLanguageRef.current !== selectedLanguage) {
      // Save current language data immediately (bypass debounce)
      const state = loadIdeState() || createEmptyState();

      state.languageData[prevLanguageRef.current] = {
        code,
        testCases,
        lastModified: Date.now(),
      };
      saveIdeState(state);

      // Restore new language data
      const newLanguageData = state.languageData[selectedLanguage];

      if (newLanguageData && (newLanguageData.code || newLanguageData.testCases.length > 0)) {
        setCode(newLanguageData.code);
        setTestCases(
          newLanguageData.testCases.length > 0
            ? newLanguageData.testCases
            : [DEFAULT_TEST_CASE]
        );
      } else {
        // Use template for new language
        setCode(IDE_TEMPLATES[selectedLanguage]);
        setTestCases([DEFAULT_TEST_CASE]);
      }

      prevLanguageRef.current = selectedLanguage;
    }
  }, [selectedLanguage, mode, code, testCases, setCode, setTestCases]);

  // Effect 4: Cleanup - Save on unmount
  useEffect(() => {
    return () => {
      if (mode === 'ide' && hasHydratedRef.current) {
        const state = loadIdeState() || createEmptyState();

        state.languageData[selectedLanguage] = {
          code,
          testCases,
          lastModified: Date.now(),
        };
        state.lastUsedLanguage = selectedLanguage;

        saveIdeState(state);
      }
    };
  }, [code, testCases, selectedLanguage, mode]);
}
