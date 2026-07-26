/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TS source (no build step), so Next must
  // transpile them like first-party code rather than treating them as
  // pre-built node_modules.
  transpilePackages: ["@cc/ui", "@cc/domain", "@cc/config"],
  reactStrictMode: true,
  // `pnpm lint` (eslint.config.js, flat config) is the authoritative lint
  // step in CI; Next's own build-time ESLint detection doesn't recognize
  // flat config yet and would otherwise warn on every build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
