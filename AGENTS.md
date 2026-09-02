# Seedexchange project instructions

## Scope and current state

This repository is the new Fastify, EJS, TypeScript and PostgreSQL implementation for `seedexchange.online`. It is an early migration target, not the current production source.

The working PHP/MySQL application remains available for read-only comparison at `../apps/seedexchange-php`. The parent `../` directory also contains the historical plans, release packages and the original `DESIGN.md`. Do not edit or deploy the legacy application unless a task explicitly authorizes it.

## Safety boundaries

- Default to local work and read-only production inspection.
- Never deploy, change DNS, import a production database, enable payments, create credentials or cut traffic over without explicit approval.
- Keep `.env`, credentials, database dumps and customer data out of Git.
- Stripe Connect, marketplace payments and payouts remain disabled until their complete flows and failure modes are migrated and accepted.
- Treat the PHP application as behavioral evidence, not code to copy mechanically. Preserve contracts deliberately and record deviations.

## Source-of-truth order

1. Approved migration decisions in `MIGRATION.md`.
2. Current code and tests in this repository.
3. Product and visual rules in this repository's `DESIGN.md`.
4. The legacy PHP implementation and parent documentation as comparison evidence.
5. Release bundles only as deployment snapshots, never as editable source.

## Architecture boundaries

- Content/data: editorial copy belongs in dedicated content modules; transactional records belong in PostgreSQL.
- Structure: routes and EJS templates arrange semantic UI and consume supplied view models.
- Design: shared tokens and components belong in `public/assets/app.css`; avoid inline styles and duplicated page CSS.
- Business logic must not live in templates. Database queries must not live in templates or CSS.
- Prefer small vertical slices with explicit read models, validation, authorization and tests.

## Migration workflow

For each feature: inventory the legacy route, schema and side effects; document the contract; implement one vertical slice; add automated checks; compare representative behavior; update `MIGRATION.md`. A local build or healthy `/health` response does not prove production readiness.

Do not migrate mock data, secrets, stale release artifacts or PHP/MySQL-specific workarounds unless the target still requires the behavior.

## Local verification

Use the repository's existing Node.js installation unless dependency changes are required.

```powershell
npm run check
npm run build
npm start
```

Then verify `/health`, `/`, the static pages and representative assets. Database-backed features require an isolated local PostgreSQL database. Tests must never point at a remote or production DSN.

Before claiming a feature complete, report what was tested, what was not tested and whether the evidence is local, staging or production.
