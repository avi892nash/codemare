import { handlers } from '@/auth';

// Auth.js's request handlers for /api/auth/* (sign-in, callback, signout, csrf).
// The Auth.js library does all the heavy lifting; we just re-export.
export const { GET, POST } = handlers;
