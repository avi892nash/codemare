const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The monorepo lives one level up. Telling Next.js explicitly avoids the
  // "multiple lockfiles detected" warning when started via the root
  // `npm run dev` script that uses workspaces.
  outputFileTracingRoot: path.join(__dirname, '..'),
  experimental: {
    // Server actions are GA in Next 15 — keep the block for forward-compat.
  },
};

module.exports = nextConfig;
