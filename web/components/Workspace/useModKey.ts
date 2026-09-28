'use client';

import { useEffect, useState } from 'react';

/**
 * The shortcut modifier to print: "⌘" on Apple platforms, "Ctrl " elsewhere.
 * Starts as "⌘" (what the server renders) and corrects itself after mount.
 */
export function useModKey(): string {
  const [mod, setMod] = useState('⌘');
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
    if (!/mac|iphone|ipad|ipod/i.test(platform)) setMod('Ctrl ');
  }, []);
  return mod;
}
