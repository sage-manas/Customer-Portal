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
    "@cc/service-health",
    "@cc/service-support",
    "@cc/service-loyalty",
    "@cc/service-reporting",
    "@cc/service-notification",
    "@cc/service-sap",
    "@cc/adapter-cache",
    "@cc/adapter-notifications",
    "@cc/adapter-sap",
    "@cc/adapter-gstn",
    "@cc/adapter-storage",
    "@cc/db",
    "@cc/observability",
  ],
  reactStrictMode: true,
  // `pnpm lint` (eslint.config.js, flat config) is the authoritative lint
  // step in CI; Next's own build-time ESLint detection doesn't recognize
  // flat config yet and would otherwise warn on every build.
  eslint: { ignoreDuringBuilds: true },
  // OpenTelemetry's Node auto-instrumentation and the Sentry SDK both use
  // conditional/dynamic `require()` to detect optional exporters and
  // instrumented libraries — the exact pattern webpack's static bundler
  // cannot follow (docs/07 B3). Left external, Node's own `require`
  // resolves them normally at runtime for the actual Node.js server;
  // `@cc/observability` itself stays in `transpilePackages` above so its
  // first-party TypeScript is still processed like any other workspace
  // package — only its heavy npm dependencies are excluded from bundling.
  serverExternalPackages: [
    "pino",
    "thread-stream",
    "@opentelemetry/instrumentation",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/resources",
    "@opentelemetry/semantic-conventions",
    "@sentry/node",
    "require-in-the-middle",
  ],
};

export default nextConfig;
