# CustomerConnect Portal

Multi-tenant, SAP-integrated B2B Customer Self-Service Portal SaaS covering the full Order-to-Cash cycle for Indian enterprises (GST/e-invoice/e-way-bill compliant). See `docs/00-PORTAL-OVERVIEW.md` for what this is and `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md` for how it's being built.

## Status

**Phase 0 — Foundation**, per `docs/04-ROADMAP-ZERO-TO-PRODUCTION.md`. The monorepo scaffold, tenant-isolated database layer, domain registries (Onboarding + Order modules), and the first UI components exist; feature modules and auth land in the phases that follow.

## Repo shape

See `CONTRIBUTING.md` for the full package layout and dependency rules.

## Quick start

```
pnpm install
docker compose -f docker-compose.dev.yml up -d      # Postgres + Redis
cp packages/db/.env.example packages/db/.env
pnpm --filter @cc/db db:push

pnpm --filter web dev            # http://localhost:3000
pnpm --filter @cc/ui storybook   # http://localhost:6006
```

```
pnpm turbo run typecheck lint test build   # whole repo
```

## Docs

`docs/00` through `docs/06` are the product/architecture source of truth (overview, PRD, TRD, functional spec, roadmap, UI/UX spec, build kickoff prompt). `docs/DECISIONS.md` is the running ADR log for anything those docs left ambiguous.
