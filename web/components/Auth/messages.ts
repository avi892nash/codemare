/**
 * Copy for Auth.js error codes that reach /signin as `?error=<code>` (it is
 * both `pages.signIn` and `pages.error` in auth.ts). Pure; unknown codes get
 * a generic line so nothing internal is ever echoed back.
 */
const AUTH_ERRORS: Record<string, string> = {
  CredentialsSignin: 'Invalid email or password.',
  OAuthAccountNotLinked:
    'That email already has a Codemare account. Sign in with its password instead.',
  OAuthSignInError: 'GitHub sign-in did not complete. Try again.',
  OAuthCallbackError: 'GitHub sign-in did not complete. Try again.',
  AccessDenied: 'Access was denied.',
  Verification: 'That sign-in link is invalid or has expired.',
  Configuration: 'Sign-in is not configured correctly on the server. Try again later.',
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTH_ERRORS[code] ?? 'Could not sign you in. Try again.';
}

/** Message for a failed credentials sign-in (signIn() result `code`). */
export function credentialsErrorMessage(code: string | null | undefined): string {
  return code === 'rate_limited'
    ? 'Too many sign-in attempts. Wait a few minutes and try again.'
    : 'Invalid email or password.';
}

/** First value of a search param. */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
