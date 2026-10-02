'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';

interface FilterNav {
  /** Navigate to a filtered URL inside a transition (keeps scroll). */
  navigate: (href: string, opts?: { replace?: boolean }) => void;
  /** A filter navigation is waiting for the server. */
  pending: boolean;
}

const FilterNavContext = createContext<FilterNav | null>(null);

/**
 * Shared by a page's filter controls and its results: filters navigate
 * through `navigate` (router push/replace in a transition), and
 * <PendingRegion> dims the server-rendered results until the new ones land.
 */
export function FilterNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (href: string, opts?: { replace?: boolean }) => {
      startTransition(() => {
        if (opts?.replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [router]
  );
  const value = useMemo(() => ({ navigate, pending }), [navigate, pending]);
  return <FilterNavContext.Provider value={value}>{children}</FilterNavContext.Provider>;
}

export function useFilterNav(): FilterNav {
  const ctx = useContext(FilterNavContext);
  if (!ctx) throw new Error('useFilterNav must be used inside <FilterNavProvider>');
  return ctx;
}

/** Wraps results: aria-busy + a dimmed look while a filter change is pending. */
export function PendingRegion({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { pending } = useFilterNav();
  return (
    <div
      className={className}
      aria-busy={pending || undefined}
      style={{ transition: 'opacity 0.15s', opacity: pending ? 0.55 : 1, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * A local, optimistic copy of URL-derived filter state. Controls render from
 * it and build the next URL from `ref.current`, so several quick changes
 * compose instead of each starting from the not-yet-updated URL. It adopts
 * the server's `value` whenever no navigation is pending.
 */
export function useSettledState<T>(value: T, pending: boolean): [T, (next: T) => void, MutableRefObject<T>] {
  const [state, setState] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    if (!pending) {
      ref.current = value;
      setState(value);
    }
  }, [value, pending]);
  const set = useCallback((next: T) => {
    ref.current = next;
    setState(next);
  }, []);
  return [state, set, ref];
}
