# ops (platform operator console) — stub

Per `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`: "`ops/` — platform operator console (stub for now)."

This directory is intentionally not yet a working app. It has no `package.json` and is not a pnpm workspace member — there's nothing here for tooling to build, lint, or typecheck, so it can't silently rot as the rest of the monorepo evolves. It becomes a real Next.js app (tenant CRUD, plan/billing management, usage metering, health monitoring, feature flags — `docs/01-PRD.md` FR-PLT-5) when the roadmap reaches platform-operator tooling, following the same scaffold pattern as `apps/web`.
