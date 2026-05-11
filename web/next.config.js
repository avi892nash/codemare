/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server actions are GA in Next 15 but keep this here for clarity.
  },
};

module.exports = nextConfig;
