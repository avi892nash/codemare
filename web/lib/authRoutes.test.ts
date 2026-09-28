import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AFTER_SIGN_IN,
  decideRoute,
  isAuthPage,
  safeNextPath,
  signInHref,
} from '@/components/Auth/routes';
import { authErrorMessage, credentialsErrorMessage } from '@/components/Auth/messages';

describe('safeNextPath', () => {
  it('keeps plain same-origin paths with their query and hash', () => {
    expect(safeNextPath('/problems')).toBe('/problems');
    expect(safeNextPath('/problems?q=graph&tag=bfs')).toBe('/problems?q=graph&tag=bfs');
    expect(safeNextPath('/submissions/abc#tests')).toBe('/submissions/abc#tests');
    expect(safeNextPath('/')).toBe('/');
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['relative', 'problems'],
    ['absolute URL', 'https://evil.com/'],
    ['protocol-relative', '//evil.com'],
    ['backslash', '/\\evil.com'],
    ['inner backslash', '/foo\\bar'],
    ['tab trick', '/\t/evil.com'],
    ['newline', '/a\nb'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['too long', `/${'a'.repeat(3000)}`],
  ])('rejects %s', (_label, raw) => {
    expect(safeNextPath(raw as string | null)).toBeNull();
  });

  it('refuses to bounce back to an auth page (it would loop)', () => {
    expect(safeNextPath('/signin')).toBeNull();
    expect(safeNextPath('/signup?next=/x')).toBeNull();
    expect(safeNextPath('/reset?token=abc')).toBeNull();
    expect(safeNextPath('/auth')).toBeNull();
    // Only the exact segments: look-alikes are fine.
    expect(safeNextPath('/signing-guide')).toBe('/signing-guide');
  });
});

describe('isAuthPage / signInHref', () => {
  it('knows the public auth pages and the legacy alias', () => {
    for (const p of ['/signin', '/signup', '/forgot', '/reset', '/auth']) expect(isAuthPage(p)).toBe(true);
    expect(isAuthPage('/problems')).toBe(false);
    expect(isAuthPage('/resetting')).toBe(false);
  });

  it('carries a safe next and drops the rest', () => {
    expect(signInHref('/problems?q=dp')).toBe('/signin?next=%2Fproblems%3Fq%3Ddp');
    expect(signInHref('/')).toBe('/signin');
    expect(signInHref('//evil.com')).toBe('/signin');
    expect(signInHref(null)).toBe('/signin');
    expect(signInHref('/map', '/signup')).toBe('/signup?next=%2Fmap');
  });
});

describe('decideRoute (middleware)', () => {
  const route = (path: string, signedIn: boolean, search = '', production = false) =>
    decideRoute({ path, search, signedIn, production });

  it('walls every page for signed-out visitors, remembering where they were going', () => {
    expect(route('/problems', false, '?q=graph')).toEqual({ type: 'redirect', to: '/signin?next=%2Fproblems%3Fq%3Dgraph' });
    expect(route('/submissions/abc', false)).toEqual({ type: 'redirect', to: '/signin?next=%2Fsubmissions%2Fabc' });
    expect(route('/', false)).toEqual({ type: 'redirect', to: '/signin' });
  });

  it('answers signed-out API calls with 401 instead of a redirect', () => {
    expect(route('/api/run', false)).toEqual({ type: 'unauthorized' });
    expect(route('/api/run', true)).toEqual({ type: 'next' });
  });

  it('keeps the auth pages public and sends signed-in visitors on', () => {
    for (const p of ['/signin', '/signup', '/forgot', '/reset', '/auth']) {
      expect(route(p, false)).toEqual({ type: 'next' });
      expect(route(p, true)).toEqual({ type: 'redirect', to: DEFAULT_AFTER_SIGN_IN });
    }
    expect(route('/signin', true, '?next=%2Fsubmissions')).toEqual({ type: 'redirect', to: '/submissions' });
    expect(route('/signin', true, '?next=%2F%2Fevil.com')).toEqual({ type: 'redirect', to: DEFAULT_AFTER_SIGN_IN });
    expect(route('/signin', true, '?next=%2Fsignin')).toEqual({ type: 'redirect', to: DEFAULT_AFTER_SIGN_IN });
  });

  it('opens /dev only outside production', () => {
    expect(route('/dev/system', false)).toEqual({ type: 'next' });
    expect(route('/dev/system', false, '', true)).toEqual({ type: 'redirect', to: '/signin?next=%2Fdev%2Fsystem' });
    expect(route('/development', false)).toEqual({ type: 'redirect', to: '/signin?next=%2Fdevelopment' });
  });

  it('lets signed-in users through everywhere else', () => {
    expect(route('/problems', true)).toEqual({ type: 'next' });
    expect(route('/', true)).toEqual({ type: 'next' });
  });
});

describe('auth messages', () => {
  it('maps Auth.js error codes without echoing unknown ones', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('CredentialsSignin')).toMatch(/invalid email or password/i);
    expect(authErrorMessage('<script>')).toBe('Could not sign you in. Try again.');
    expect(credentialsErrorMessage('rate_limited')).toMatch(/too many/i);
    expect(credentialsErrorMessage('credentials')).toMatch(/invalid email or password/i);
  });
});
