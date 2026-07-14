'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/primitives';

/**
 * Client-side sign-out control. Calls next-auth's signOut() on click and
 * redirects to '/' — replaces the inline server-action form so the button's
 * onClick typechecks cleanly under @types/react 18.
 */
export function SignOutButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      icon="lock-open"
      onClick={() => signOut({ redirectTo: '/' })}
    >
      Sign out
    </Button>
  );
}
