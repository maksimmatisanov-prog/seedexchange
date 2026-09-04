# Seedexchange migration status

Audit snapshot: 2026-09-02.

Status refresh: 2026-09-04. The local homepage redesign passes TypeScript, Vitest, clean build and public Playwright checks. Production, DNS, staging data and payment flags were not changed.

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
- Seller fulfilment from paid through processing, tracked shipment, buyer confirmation and delivery-case transfer holds.
- Buyer/organization conversations, outbox delivery, reservation/transfer worker and sitemap generation.
- Allowlisted MySQL inventory/dry-run/import command with empty-target, run fingerprint, counts and orphan checks.
- Botanical Archive responsive UI, unit/integration/Playwright checks, PostgreSQL 16 CI and immutable staging/rollback templates.
- Fail-closed two-stage launch contract: discovery exposes only approved HTTPS external offers and blocks cart, checkout, Stripe webhook handling and marketplace-worker mutations; commerce requires an explicit phase plus payment flags.
- Release readiness reports the active launch phase and capability flags. The deploy verifier rejects a release when runtime readiness does not match the explicitly expected phase.

## Remaining before staging acceptance

- Complete media upload/resize/storage handling with source provenance.
- Reviews, reports, collections/journal and complete notification interaction screens.
- Stripe Connect onboarding, refund, partial refund, dispute, reversal and delivery-case acceptance in test mode.
- Approve payment-cost allocation, international seed-trade restrictions, prohibited-item policy, seller service levels and support procedures.
- Fresh production inventory and explicit legacy column/status reconciliation before any real import.
- Two full production-snapshot migration rehearsals and full media SHA-256 verification.
- Seeded buyer/seller/admin acceptance against staging, performance/load evidence, backup/restore drill and monitoring.
- Confirm repository visibility, observe a successful GitHub CI run and complete seeded buyer/seller/admin acceptance against the closed staging endpoint.

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

- Immutable release `0aea23e` was the initial deployment at `/srv/seedexchange/current` on the existing VPS. The web service listens only on `127.0.0.1:4100` and is enabled in systemd.
- The release archive SHA-256 was checked before activation. Server-side `npm ci`, TypeScript, Vitest and clean build passed; the run recorded 10 passing tests, one database integration test skipped without `TEST_DATABASE_URL`, and zero known npm audit findings.
- PostgreSQL 16 database `seedexchange_staging` is owned through the isolated `seedexchange` peer-auth role. Both ordered migrations applied once, the repeat run was a no-op, and `/ready` reported migration `002_legacy_compatibility.sql`.
- Local VPS smoke returned 200 for health, readiness, public pages, auth pages, assets, robots and sitemap; protected account, messages and admin routes returned 401 and an unknown route returned 404.
- Marketplace and sitemap workers completed successfully and their timers are enabled. Outbox remains disabled because staging SMTP is intentionally unconfigured; enabling it now would create a repeating failed job.
- `CONNECT_ENABLED`, `MARKETPLACE_PAYMENTS_ENABLED` and `PAYOUT_WORKER_ENABLED` are all `0`. No production data was imported and no production traffic, DNS or payment state was changed.
- After explicit approval, Hostinger DNS received `staging.seedexchange.online A 187.52.119.107` with TTL 300. Caddy and `APP_URL` were moved to `https://staging.seedexchange.online` behind Basic Auth, and the temporary `sslip.io` alias was removed after verification. Cloudflare, Google and the workstation resolver returned the expected address; external checks returned 401 without credentials, 200 for health, readiness, representative public pages, assets and sitemap with credentials, and 404 for an unknown route. Responses include `X-Robots-Tag: noindex, nofollow, noarchive`.
- Capacity remains staging-only: 1 vCPU, 3.8 GiB RAM and 18 GiB free disk were observed before deployment.

## Staging browser evidence from 2026-09-03

- The public Playwright suite now accepts Basic Auth through dedicated environment variables rather than credentials embedded in the staging URL.
- Remote runs use one worker and deduplicate link checks. Route-only crawling skips non-document assets, while the separate responsive-navigation and accessibility checks continue to load the complete page.
- A clean authenticated run against `https://staging.seedexchange.online` passed 9/9 checks at 375, 768 and 1440 px, including mobile/tablet menu expansion, desktop navigation visibility, public route/link responses and serious/critical WCAG checks.

## Homepage design evidence from 2026-09-03

- The local homepage now develops the existing Botanical Archive direction with a light asymmetric hero, an archive-index participation section, distinct product and organization layouts, real archive totals and a restrained Founder callout. Routes, read models, SEO metadata and business logic were preserved.
- Homepage copy and link definitions now live in `src/content/en.ts`; `src/templates/pages/home.ejs` remains structural and `public/assets/app.css` remains presentational.
- `npm run check`, `npm run build` and Vitest passed locally. Vitest recorded 11 passing tests and one database migration test skipped without `TEST_DATABASE_URL`; the homepage integration fixture covers non-empty product and organization sections.
- Local Playwright passed 9/9 public checks at 375, 768 and 1440 px, including responsive navigation and serious/critical WCAG checks. Local screenshots were reviewed at all three widths; the running page had no connected database, so its visual screenshots showed the valid zero-count state while non-empty dynamic markup was verified by the integration fixture.
- This is local evidence only. No staging or production deployment, data change, payment change or traffic change was performed for the homepage redesign.

## Discovery launch boundary evidence from 2026-09-04

- `LAUNCH_PHASE=discovery` is the default and fails closed when Connect, marketplace payments or payouts are enabled. `LAUNCH_PHASE=commerce` requires Connect and marketplace payments to be enabled together; payouts remain a separately controlled capability.
- Discovery public reads expose only approved external products with HTTPS purchase URLs. Cart navigation, cart mutations, checkout creation and Stripe webhook processing return unavailable responses, while the marketplace worker exits before database mutations.
- `/health` reports the process launch phase and capability flags without depending on PostgreSQL. `/ready` additionally requires the database and migration ledger. The release verifier rejects a runtime phase or capability mismatch before activation is accepted.
- TypeScript, Vitest and a clean build passed locally. Vitest recorded 16 passing tests and one migration test skipped without `TEST_DATABASE_URL`.
- Local Playwright passed 12/12 public checks across 375, 768 and 1440 px, including the expected discovery phase, hidden cart, blocked cart route, external-offer notice, responsive navigation, public links and serious/critical WCAG checks. Role tests remained intentionally skipped without an isolated acceptance database.
- A discovery marketplace-worker smoke used an intentionally unreachable database URL and exited with `commerce_launch_phase_disabled`, proving that the disabled path does not require a database connection. An invalid discovery configuration with marketplace payments enabled failed during configuration loading.
- This evidence is local only. The launch boundary has not yet been deployed to staging or production.

## Identity and RBAC evidence from 2026-09-03

- Seller workspace authorization now follows the shared domain rule: organization administrators and platform administrators are allowed, while buyers, non-members and ordinary organization members receive 403.
- Mutating Playwright acceptance is opt-in and fails closed unless both the application and database are loopback-only, `DATABASE_URL` matches `TEST_DATABASE_URL`, and the database name ends in `_test` or `_acceptance`.
- The isolated PostgreSQL 14 run applied both migrations and passed buyer login/logout, ordinary-member denial, seller workspace access, platform-admin denial for sellers, platform-admin dashboard access and platform-admin organization override.
- The complete local browser run passed 13 tests at the applicable viewports with 8 intentional role-test skips on mobile/tablet. The exact temporary database `seedexchange_acceptance` was deleted after the run; no staging users or data were created.
- RBAC release `5ac8602` passed server-side install, TypeScript, Vitest, build, migration no-op and readiness before activation. A post-deploy audit then identified a newly disclosed moderate issue in transitive `qs` 6.15.3.
- Follow-up release `3ca9ef0` updated only the compatible lockfile resolution to `qs` 6.16.0. Server-side install, TypeScript, Vitest, clean build, production dependency audit, migration no-op and readiness passed; `/srv/seedexchange/current` now resolves to this release.
- Post-deploy authenticated public Playwright checks passed 9/9 against staging at 375, 768 and 1440 px. The live production dependency audit reports zero known vulnerabilities.
- Local opt-in write acceptance now runs serially on desktop and covers invalid-CSRF rejection, seller product submission, shipping-zone creation, exchange publication and platform-admin product approval. It verifies stored integer cents, normalized country codes, workflow statuses, seller/admin audit events and public visibility after approval.
- Shipping-zone creation now emits `shipping_zone.created`. Product moderation returns 404 when no pending row is changed and records the explicit `product.approved` or `product.rejected` event name.
- The write acceptance passed 5/5 against an isolated PostgreSQL 14 database. Teardown returned users, organizations, products and audit events to zero before the exact temporary database was removed; staging received no fixtures.
- Immutable staging release `3e61dae` passed install, TypeScript, Vitest, clean build, zero-vulnerability production audit, migration no-op and readiness before activation. Post-deploy public Playwright checks passed 9/9; the live staging database was not seeded or mutated for acceptance.
- Seller fulfilment now supports CSRF-protected `paid -> processing -> shipped` transitions, required carrier/tracking details, a 30-day delivery deadline, buyer notification and duplicate-transition rejection. Only the owning buyer can confirm a shipped seller order; all delivered sub-orders complete the parent order.
- Buyers can open one active delivery case after shipment. The parent order becomes disputed, organization administrators are notified, confirmation is blocked while the case is open, and the existing marketplace worker continues to withhold transfer eligibility.
- Local fulfilment acceptance passed 7/7, including RBAC, invalid CSRF, repeated shipment 409, tracking persistence, parent/seller status changes, notifications and audit events. Teardown returned all eight checked entity counts to zero before the exact temporary database was removed; staging received no fixtures and payment flags remained disabled.
- Immutable staging release `11f2672` is active with PostgreSQL migration `002`, healthy process and readiness checks, and zero known production dependency vulnerabilities. External read-only Playwright passed 9/9 at 375, 768 and 1440 px; no staging fixtures, payment changes or production changes were made.

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
