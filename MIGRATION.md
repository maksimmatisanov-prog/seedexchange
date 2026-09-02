# Seedexchange migration status

Audit snapshot: 2026-09-02.

## Baseline

- Target: Fastify 5, EJS, TypeScript and PostgreSQL.
- Legacy reference: PHP/MySQL application at `../apps/seedexchange-php`.
- Repository state at the initial audit: one local commit (`027f951`), branch `master`, no remote configured, clean working tree before the documentation pass. The repository is now connected to `git@github.com:maksimmatisanov-prog/seedexchange.git` and the deployment commits have been pushed.
- Production remains on the legacy path. No deployment or production mutation was performed during this audit.

## Implemented locally

- Node 24 runtime contract, Zod environment checks and production fail-fast rules.
- Ordered SQL migrations with SHA-256 ledger, identity sequences and repeat-safe execution.
- Process-only `/health`; `/ready` checks PostgreSQL and the migration version.
- PostgreSQL sessions, CSRF, registration, email verification, password reset, throttling, RBAC, audit and PHP `$2y$` bcrypt upgrade on successful login.
- Directory, marketplace, product, exchange, search, sitemap and canonical legacy query redirects.
- Organization submission/moderation, Founder allocation, seller product/shipping/exchange workspace and admin queues.
- Server-priced cart, seller shipping, order snapshots, seller sub-orders, reservations and disabled-by-default Stripe Checkout/webhook/transfer foundations.
- Buyer/organization conversations, outbox delivery, reservation/transfer worker and sitemap generation.
- Allowlisted MySQL inventory/dry-run/import command with empty-target, run fingerprint, counts and orphan checks.
- Botanical Archive responsive UI, unit/integration/Playwright checks, PostgreSQL 16 CI and immutable staging/rollback templates.

## Remaining before staging acceptance

- Complete media upload/resize/storage handling with source provenance.
- Seller fulfilment, reviews, reports, collections/journal and notification interaction screens.
- Stripe Connect onboarding, refund, partial refund, dispute, reversal and delivery-case acceptance in test mode.
- Fresh production inventory and explicit legacy column/status reconciliation before any real import.
- Two full production-snapshot migration rehearsals and full media SHA-256 verification.
- Seeded buyer/seller/admin Playwright acceptance, performance/load evidence, backup/restore drill and monitoring.
- Confirm repository visibility, observe a successful GitHub CI run and complete authenticated browser acceptance against the closed staging endpoint.

## Safety boundary

All operational package commands now compile and exist. Payment flags remain off. The generic common-column ETL is a guarded implementation foundation, not authority to import production: it requires a fresh read-only inventory and reviewed per-column contract first.

## Verification evidence from 2026-09-02

- `npm run check`: passed.
- `npm run build`: passed as a clean build with compiled operational commands and copied SQL migrations.
- Vitest: 10 normal local tests passed; the database integration test is skipped when `TEST_DATABASE_URL` is absent.
- Isolated local PostgreSQL 14: both migrations applied on an empty database and the repeated run applied zero files.
- Playwright: 33/33 public route, broken-link and serious/critical WCAG checks passed in Chromium at 375, 768 and 1440 px.
- Clean clone: `npm ci`, TypeScript, clean build and Vitest passed without reusing `node_modules` or `dist`.
- `npm audit --json`: 0 known vulnerabilities at the recorded check.
- Local built runtime on port 4057: `/health`, `/`, `/about`, `/assets/app.css` and `/robots.txt` returned 200; an unknown route returned 404. The temporary server was stopped after the check.
- Live read-only HTTP audit: `/`, `/directory/`, `/marketplace/`, `/exchange/`, `/robots.txt` and `/sitemap.xml` returned 200. The live response identified `PHP/8.3.33`; `/health` returned 404. This confirms production is still the PHP application, not this Node target.

## Staging deployment evidence from 2026-09-02

- Immutable release `0aea23e` is active at `/srv/seedexchange/current` on the existing VPS. The web service listens only on `127.0.0.1:4100` and is enabled in systemd.
- The release archive SHA-256 was checked before activation. Server-side `npm ci`, TypeScript, Vitest and clean build passed; the run recorded 10 passing tests, one database integration test skipped without `TEST_DATABASE_URL`, and zero known npm audit findings.
- PostgreSQL 16 database `seedexchange_staging` is owned through the isolated `seedexchange` peer-auth role. Both ordered migrations applied once, the repeat run was a no-op, and `/ready` reported migration `002_legacy_compatibility.sql`.
- Local VPS smoke returned 200 for health, readiness, public pages, auth pages, assets, robots and sitemap; protected account, messages and admin routes returned 401 and an unknown route returned 404.
- Marketplace and sitemap workers completed successfully and their timers are enabled. Outbox remains disabled because staging SMTP is intentionally unconfigured; enabling it now would create a repeating failed job.
- `CONNECT_ENABLED`, `MARKETPLACE_PAYMENTS_ENABLED` and `PAYOUT_WORKER_ENABLED` are all `0`. No production data was imported and no production traffic, DNS or payment state was changed.
- After explicit approval, Caddy published `https://seedexchange-staging.187.52.119.107.sslip.io` behind Basic Auth without changing the production domain or DNS. External verification returned 401 without credentials, 200 for health, readiness, representative public pages, assets and sitemap with credentials, and 404 for an unknown route. Responses include `X-Robots-Tag: noindex, nofollow, noarchive`.
- Capacity remains staging-only: 1 vCPU, 3.8 GiB RAM and 18 GiB free disk were observed before deployment.

## Migration order

1. Freeze and document the legacy route/schema/side-effect inventory.
2. Establish PostgreSQL schema conventions, migration ledger, isolated test database and rollback policy.
3. Migrate identity, sessions, authorization and audit logging.
4. Migrate organizations, directory/search and product read paths.
5. Migrate seller writes, moderation, media and Oreshka staging with dry-run-first verification.
6. Migrate exchange/community features.
7. Migrate cart and order creation without enabling money movement.
8. Migrate Stripe webhooks, fulfilment, disputes and payouts behind disabled feature flags.
9. Run parity, security, accessibility, SEO, backup/restore and load checks in staging.
10. Prepare an approved cutover and rollback runbook; cut over only after explicit owner approval.

## Definition of done for each slice

- Legacy behavior and data contract recorded.
- Target schema and authorization rules reviewed.
- Automated success, validation, authorization and failure-path tests pass against an isolated local database.
- Representative HTML/API output is compared with the agreed contract.
- Secrets and personal data are absent from Git and test fixtures.
- `MIGRATION.md` is updated with evidence and remaining gaps.

Local tests are local evidence only. Production completion requires current production health, logs and representative user-flow verification after an explicitly authorized deployment.
