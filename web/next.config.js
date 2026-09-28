const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The monorepo lives one level up. Telling Next.js explicitly avoids the
  // "multiple lockfiles detected" warning when started via the root
  // `npm run dev` script that uses workspaces. It is also the root of the
  // standalone output's file tracing (hence .next/standalone/web/server.js).
  outputFileTracingRoot: path.join(__dirname, '..'),
  // Self-contained server bundle for the Docker image (web/Dockerfile sets
  // NEXT_OUTPUT=standalone). Opt-in so `next dev` and `next start` behave
  // exactly as before everywhere else.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  experimental: {
    // Server actions are GA in Next 15 — keep the block for forward-compat.
  },
};

module.exports = nextConfig;
