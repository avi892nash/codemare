import { useEffect, useRef } from 'react';
import { Language } from '../types/execution';
import { Mode } from '../types/storage';
import {
  loadAppState,
  saveAppState,
  createEmptyAppState,
  saveProblemCode,
} from '../utils/localStorage';

/**
 * Custom hook to persist app-level state (mode, language, problem, code)
 * This runs in EditorContext to maintain global app state across refreshes
 */
export function useAppPersistence(
  mode: Mode,
  selectedLanguage: Language,
  currentProblemId: string | null,
  code: string
): void {
  const hasHydratedRef = useRef(false);
  const prevCodeRef = useRef(code);

  // Debounced save for code changes (only in problem mode)
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (mode !== 'problem' || !currentProblemId) return;

    // Only save if code actually changed
    if (prevCodeRef.current === code) return;

    const timeoutId = setTimeout(() => {
      saveProblemCode(currentProblemId, selectedLanguage, code);
      prevCodeRef.current = code;
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [code, currentProblemId, selectedLanguage, mode]);

  // Save mode, language, and current problem (immediate)
  useEffect(() => {
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }

    const state = loadAppState() || createEmptyAppState();
    state.mode = mode;
    state.selectedLanguage = selectedLanguage;
    state.currentProblemId = currentProblemId;
    saveAppState(state);
  }, [mode, selectedLanguage, currentProblemId]);

  // Cleanup: save on unmount
  useEffect(() => {
    return () => {
      if (mode === 'problem' && currentProblemId && code) {
        saveProblemCode(currentProblemId, selectedLanguage, code);
      }

      const state = loadAppState() || createEmptyAppState();
      state.mode = mode;
      state.selectedLanguage = selectedLanguage;
      state.currentProblemId = currentProblemId;
      saveAppState(state);
    };
  }, [mode, selectedLanguage, currentProblemId, code]);
}

/**
 * Hook to restore app state on mount
 * Returns the persisted state or null if none exists
 */
export function useAppStateRestoration() {
  const stateRef = useRef(loadAppState());
  return stateRef.current;
}
