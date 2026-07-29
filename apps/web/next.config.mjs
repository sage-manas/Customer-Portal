/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TS source (no build step), so Next must
  // transpile them like first-party code rather than treating them as
  // pre-built node_modules.
  transpilePackages: [
    "@cc/ui",
    "@cc/domain",
    "@cc/config",
    "@cc/service-identity",
    "@cc/service-onboarding",
    "@cc/service-catalogue",
    "@cc/service-order",
    "@cc/service-delivery",
    "@cc/service-support",
    "@cc/service-sap",
    "@cc/adapter-sap",
    "@cc/adapter-gstn",
    "@cc/adapter-storage",
    "@cc/db",
  ],
  reactStrictMode: true,
  // `pnpm lint` (eslint.config.js, flat config) is the authoritative lint
  // step in CI; Next's own build-time ESLint detection doesn't recognize
  // flat config yet and would otherwise warn on every build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
