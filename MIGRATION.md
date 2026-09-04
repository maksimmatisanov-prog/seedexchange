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
- Organization submission/moderation, Founder allocation, discovery-safe organization profile/contact/exchange workspace, commerce-gated product/shipping/order tools and admin queues.
- Server-priced cart, seller shipping, order snapshots, seller sub-orders, reservations and disabled-by-default Stripe Checkout/webhook/transfer foundations.
- Seller fulfilment from paid through processing, tracked shipment, buyer confirmation and delivery-case transfer holds.
- Buyer/organization conversations, outbox delivery, reservation/transfer worker and sitemap generation.
- Allowlisted MySQL inventory/dry-run/import command with empty-target, run fingerprint, counts and orphan checks.
- Botanical Archive responsive UI, unit/integration/Playwright checks, PostgreSQL 16 CI and immutable staging/rollback templates.
- Fail-closed two-stage launch contract: discovery exposes only approved HTTPS external offers and blocks cart, checkout, Stripe webhook handling and marketplace-worker mutations; commerce requires an explicit phase plus payment flags.
- Release readiness reports the active launch phase and capability flags. The deploy verifier rejects a release when runtime readiness does not match the explicitly expected phase.

## Remaining before staging acceptance

- Rehearse migrated-media copy/manifests and backup/restore handling on the isolated production target.
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
- Local Playwright passed 12/12 public checks across 375, 768 and 1440 px. The suite now performs the full route/link crawl once on desktop while retaining responsive navigation and serious/critical WCAG checks at every viewport; this stays below the real 100-request/minute application limit. It confirmed discovery mode, all four disabled commerce capability flags, security headers, hidden cart, the external-offer notice and 404 responses for cart add/remove, checkout, Stripe webhook, seller product/shipping/order and ordinary product-moderation mutations. When `PLAYWRIGHT_EXPECT_MIGRATION` is supplied on a DB-backed target, the same test additionally requires `/ready` to report that exact migration; the local database-free run did not exercise that conditional assertion.
- A discovery marketplace-worker smoke used an intentionally unreachable database URL and exited with `commerce_launch_phase_disabled`, proving that the disabled path does not require a database connection. An invalid discovery configuration with marketplace payments enabled failed during configuration loading.
- This evidence is local only. The launch boundary has not yet been deployed to staging or production.

## Oreshka supplier-feed evidence from 2026-09-04

- The Node target now parses normalized JSON and Oreshka CSV feeds, caps input at 20 MB and defaults the operational command to a database-free dry run.
- The import rejects feeds below 99% acceptance, duplicate external IDs, unsupported values, non-HTTPS links, product links outside `oreshka-seeds.com` and images outside `static.tildacdn.com` before opening a database transaction.
- A committed staging import requires an approved organization. It marks unseen catalog rows stale, upserts normalized supplier rows, records an import report and can optionally synchronize already-published external offers.
- Live synchronization changes only price, compare-at price, stock and source timestamp automatically. Editorial or link changes are held as `review_required`; missing feed rows remain published at zero stock with `source_sync_status='stale'`.
- Referral URLs preserve existing query parameters and receive the `seedexchange.online / referral / oreshka_catalog` UTM tuple. CSV snapshots do not contain the import clock, so identical source data stays deterministic.
- Unit coverage verifies normalization, CSV quoting and malformed-row reporting, the host allowlist, duplicate detection, the acceptance-rate boundary and stable referral tracking. This is local implementation evidence only; no supplier feed or staging/production database was changed.
- An isolated PostgreSQL 14 integration run applied both migrations, committed one normalized feed row, produced the same SHA-256 snapshot in dry-run and write modes, created a one-item pending batch and activated it only after moderation. The resulting product was `active`, `external`, `current`, linked to its publication batch and carried the expected referral URL.
- The same isolated run held an editorial title change as `review_required`, applied it only through a separate content-review batch, and rejected a later approval after the staged supplier snapshot was deliberately changed. Both preparation and moderation audit events were present. The temporary database cluster was stopped and removed afterward.

## Discovery data-migration boundary from 2026-09-04

- The legacy migration command now defaults to `--scope=discovery`. This scope includes accounts required by organization ownership, organizations, media metadata, external supplier/catalog batches, external products, exchange listings, organization channels, conversations and audit history.
- Discovery explicitly excludes shipping, orders, reservations, Stripe events, seller transfers, delivery cases and review entities. It refuses to start against a target containing commerce records, selects only `purchase_mode='external'` products and validates both its destination and optional external image as syntactically public HTTPS URLs without embedded credentials before insertion.
- Imported organizations have `marketplace_enabled`, Stripe account, charge and payout capabilities reset even if legacy rows contain enabled values. Runtime discovery flags remain a separate fail-closed gate.
- Inventory fingerprints now include a SHA-256 checksum of every selected source row rather than counts alone. Import parity compares each source table with its mapped target, including differently named tables in the later full scope.
- This is a local migration-contract change. No production source was connected, inventoried or imported, and no staging data changed.
- PostgreSQL 14 applied migrations `001`–`003` on an empty temporary database and a repeat run applied zero files. The deploy verifier now also requires `/ready` to report the latest migration bundled in the release, preventing activation on an older schema.
- A production discovery-data verifier and cutover runbook now require a successful fingerprinted discovery import, an external-only data set, disabled organization payment capabilities, completed moderation and sitemap health before DNS activation. Production service and Caddy examples use an isolated root, database environment and loopback port rather than staging state.
- The compiled discovery-data verifier was exercised against an isolated PostgreSQL 14 database. A migration-003 dataset with a successful discovery run, verified administrator, approved organization and active HTTPS external product returned `ready: true`; inserting one shipping row changed it to `ready: false` with `Commerce tables contain rows during discovery launch.` The temporary cluster was then stopped and removed.
- Public catalog read models now repeat the URL boundary at render time: an external product with an unsafe destination is hidden, while an unsafe image is omitted. The discovery readiness command evaluates parsed URL semantics rather than trusting a `^https://` database regex, and the guarded Oreshka feed rejects links containing embedded credentials.
- TypeScript, a clean build and Vitest passed locally with 51 passing tests and one migration test skipped without `TEST_DATABASE_URL`. A separate PostgreSQL 14 smoke applied migrations `001`–`003`: an active external product whose image was `https://localhost/...` made compiled discovery readiness exit 1 with the external-offer contract error; replacing only that image with a public HTTPS URL made the same gate exit 0 with `ready: true`. The temporary database, cluster and media root were removed.
- Discovery inventory, dry-run and import now require every planned legacy table and an explicit set of semantic source columns. Missing tables or required columns stop before target writes; dry-run also refuses unreviewed source-only or target-only columns and required target-only columns. The only approved target-only differences are nullable `media_assets.sha256` and `products.publication_batch_id`. Inventory entries include their ordered source-column list, so even empty-table schema drift changes the combined fingerprint.
- All source row reads now share one MySQL/MariaDB repeatable-read, read-only consistent snapshot. PostgreSQL writes remain in one transaction. Identity reset checks the actual PostgreSQL sequence before calling `setval`, so the seeded non-sequence `founder_program_state.id` is imported safely and empty identity tables retain the correct next value.
- An isolated MariaDB 10.4 to PostgreSQL 14 rehearsal applied the complete current legacy schema plus migrations `002`–`014`, then passed discovery inventory, dry-run, one import and compiled readiness. The target contained one administrator, approved organization, external product and exchange, zero commerce rows and one successful fingerprinted discovery run; readiness returned `true`. Removing required source column `users.last_login_at` made inventory exit 1 with the exact contract error. Both database processes and the temporary database/media directories were removed.
- A second clean-schema rehearsal confirmed that dry-run reports exactly the two approved target-only fields and no others. Adding one unexpected nullable target column made dry-run exit 1 with the exact unreviewed target-only error. Both temporary listeners were stopped and the retained directory was removed after MariaDB released its final file handle.
- Read-only inventory and dry-run commands now accept exclusive `--output=<new.json>` evidence paths and include a unique `runId`; import deliberately cannot use file output because its authoritative result is the PostgreSQL migration-run record. `verify:discovery-rehearsal` requires exactly two inventory and two dry-run files from four distinct runs, recomputes each inventory fingerprint, compares exact table counts/checksums/ordered columns, validates complete compatibility and reports each evidence file's own SHA-256.
- Vitest passed 55 tests with one database migration test skipped without `TEST_DATABASE_URL`; coverage includes matching reports, duplicate run IDs, inventory drift, incomplete import maps, target-only drift and an actual operational CLI process reading four temporary files. TypeScript and the clean build passed, and the temporary report directory was removed by the test.
- `ops/production.env.example` and `verify:production-env` now define the phase-1 runtime boundary before service installation: production origin/port/storage, discovery-only flags, a local dedicated `seedexchange_production` database with a non-superuser role, complete encrypted SMTP, a non-placeholder session secret, no Stripe secrets and no retained legacy MySQL access. Duplicate keys are rejected and the report exposes only field names, never values.
- Vitest passed 60 tests with one database migration test skipped without `TEST_DATABASE_URL`; an operational CLI test accepted a complete temporary environment without echoing session or mail secrets. The compiled verifier intentionally rejected the repository example until its private placeholders are replaced. TypeScript and the clean build passed, and all temporary test files were removed.
- `manifest:discovery-backup` now streams and fingerprints exactly three distinct non-empty regular files—the MySQL dump, uploads archive and exact legacy release—into an exclusive versioned manifest. `verify:discovery-backup` re-fingerprints restored copies and requires matching roles, filenames, byte sizes and SHA-256; neither command emits artifact contents, and the runbook keeps database/media/release restore acceptance as a separate requirement.
- Vitest passed 62 tests with one database migration test skipped without `TEST_DATABASE_URL`. Operational CLI coverage created and verified a temporary three-artifact manifest, rejected an overwrite, detected changed content and rejected an empty artifact. TypeScript and the clean build passed, and the temporary artifacts and manifest were removed.
- A read-only production runtime gate now checks the loopback service through `Host: seedexchange.online`: health/readiness and the exact migration, every disabled commerce capability, representative organization/product/media routes, the external-only product action, discovery payment notice, canonical URLs, sitemap membership, production security headers, assets and a deliberate 404. The command accepts no credentials and sends only GET requests; it does not replace browser acceptance or authenticated administrator checks.
- TypeScript, 66 Vitest checks and a clean build passed locally; one PostgreSQL migration test remained skipped without `TEST_DATABASE_URL`. Coverage includes the actual operational CLI against a temporary HTTP listener and its fixed production Host header. A temporary production-mode Fastify process also confirmed the required headers on health, static CSS and the deliberate 404, then was stopped. No staging or production endpoint was contacted.
- CI now assembles a production-discovery tarball from successful `master` pushes only, instead of a loose, non-self-verifying file set. Pull requests and feature branches still run verification but emit no production artifact. The dependency-free `RELEASE.json` gate pins the Git commit/tree, Node 24, newest migration and SHA-256 of every allowlisted runtime file; it rejects secrets, unknown payload paths, links, missing files and post-build drift before package installation.
- Production preparation and activation are separate approval-gated scripts under `/srv/seedexchange-production`. Preparation verifies the outer archive and internal manifest, installs locked runtime dependencies, validates the isolated environment and applies schema migrations without switching the service. Activation rechecks release/media/data readiness, swaps only the production symlink, requires readiness plus representative discovery runtime acceptance, and rolls the application pointer back on failure without touching Caddy or DNS.
- TypeScript, 69 Vitest checks and a clean build passed locally; one PostgreSQL migration test remained skipped without `TEST_DATABASE_URL`. Both production Bash scripts passed syntax checking and exited with code 2 before touching paths when their distinct approval flags were absent. The GitHub Actions workflow parsed successfully, and a full 250-file release layout reported migration `003_discovery_migration_scope.sql`; its copied verifier passed from the temporary artifact itself before any `node_modules` directory existed. All temporary release directories were removed; no remote service or repository was changed.
- The production artifact now carries an exact hardened systemd bundle for the web process, outbox and sitemap. Its release manifest requires all five units, activation rejects installed-file drift and drop-ins, and successful private acceptance enables only those units. No production marketplace/order/payout worker exists in the bundle. The older loose production service example is explicitly deprecated to prevent accidental installation.
- Registration and password-reset outbox messages now use the validated configured application origin and absolute token URLs; the former relative verification URL would not have worked from an email client. URL construction rejects malformed tokens and credential-bearing origins.
- TypeScript, 75 Vitest checks and a clean build passed locally; one PostgreSQL migration test remained skipped without `TEST_DATABASE_URL`. The current dependency-free pre-install gate accepted the complete 259-file artifact with exactly the five production units and migration `003_discovery_migration_scope.sql`, with no `node_modules` present. The temporary artifact was removed and no external email, service, repository or production state changed.
- Production activation now finishes its initial sitemap/outbox cycle with a sanitized, read-only operational observation. It requires migration `003`, the dedicated `seedexchange_production` database, less than 80% connection use, no query active for more than 30 seconds, no session idle in a transaction for more than 60 seconds, no failed or stale outbox work and a non-symlink sitemap newer than 90 minutes containing the representative organization and external product. The same exclusive-output command supplies checksum-addressed evidence during the 24-hour observation window.
- Sitemap generation now writes a unique sibling file and atomically renames it into place, so readers do not observe a partially written XML document. An isolated PostgreSQL 14 smoke applied migrations `001`–`003`, inserted one approved organization and active HTTPS external offer, generated an 809-byte sitemap and returned `ready: true` from the compiled observation command with 3 of 100 connections and zero database/outbox warnings. Its exclusive report was readable and checksummed; the temporary database, files and listener were removed.
- TypeScript, 78 Vitest checks and a clean build passed locally; one PostgreSQL migration test remained skipped without `TEST_DATABASE_URL`. Both production Bash scripts passed syntax checking and activation without its owner-approval flag still exited with code 2 before path or service work. The dependency-free verifier accepted a complete 267-file artifact containing the observation command, exactly five production units and migration `003_discovery_migration_scope.sql`, with no `node_modules` present. The temporary artifact was removed; no staging, production or remote repository state changed.
- Failed production activation now stops the discovery timers before restoring the previous `current` symlink and explicitly restarts the web service from that previous release. This closes the case where `enable --now` could leave an already-running failed-release process alive after only the symlink had been rolled back. A structural regression test pins the required stop, symlink switch, process restart and timer re-enable order; TypeScript, 79 Vitest checks, Bash syntax and a clean build passed locally with one database test skipped. No service or remote state was changed.
- The compiled discovery load gate accepts only credential-free loopback origins, fixes the production Host header, sends GET requests to health/readiness and representative public routes, bounds concurrency, timeouts and response bytes, and records aggregate route timings without bodies. The runtime gate now shares the loopback-only boundary and accepts only exact organization, product and 40-hex WebP paths. Activation runs 72 requests at concurrency 6 with a 750 ms overall p95 ceiling before enabling timers. An initial 120-request rehearsal correctly crossed the application's 100-request security limit and returned 21 HTTP 429 responses; the activation budget was reduced so the preceding readiness/runtime probes plus the load gate remain below that limit.
- The exact local pre-activation sequence then passed against Fastify and an isolated PostgreSQL 14 migration-003 database: readiness and all 13 runtime checks passed, followed by 72 of 72 HTTP 200 load responses with p50 10 ms, p95 83 ms, p99/max 137 ms and 328.77 requests/second. This is bounded local regression evidence, not a production capacity claim. TypeScript, 83 Vitest checks, Bash syntax and the clean build passed with one database test skipped; the dependency-free manifest verifier accepted a 275-file artifact containing the load command, five production units and no `node_modules`. All temporary processes, data and reports were removed; no remote state changed.

## Discovery organization and exchange workspace from 2026-09-04

- The organization workspace now matches the first launch phase: approved organizations can maintain their public profile and public contact channels, publish detailed exchange or donation listings, and mark active listings completed or withdrawn.
- Email is normalized to a public `mailto:` link. Social and marketplace channels require HTTPS and an official service hostname; changing a saved channel resets its verification flag. Invalid public links return a user-facing 400 response.
- Public read models revalidate stored profile, channel and exchange-contact URLs, so unsafe legacy/imported values are omitted rather than emitted into HTML.
- Public organization pages now expose profile specialties, public contacts and the organization's active exchange/donation listings. The exchange directory exposes variety, category, origin, requested exchange and an explicit external contact path when supplied.
- Internal marketplace product submission, shipping-zone writes, seller fulfilment and marketplace-product moderation are absent from the discovery workspace and return 404 on direct requests. Their database reads are also skipped in discovery.
- TypeScript and Vitest passed locally. Vitest recorded 33 passing tests and one migration test skipped without `TEST_DATABASE_URL`; coverage includes URL normalization, hostile/wrong-domain rejection, public organization exchange rendering and direct discovery requests to five commerce mutation routes.
- An isolated PostgreSQL 14 run applied migrations `001`–`003` and passed 16 browser checks: 12 public responsive/accessibility/launch-boundary checks plus buyer/member/seller RBAC and the discovery organization workflow. The workflow verified persisted profile fields, normalized channels, a public exchange listing, public rendering, withdrawal and four audit events; commerce forms stayed absent. Twenty commerce/responsive role permutations were intentionally skipped. The temporary cluster was stopped and removed.
- This is local implementation evidence. No staging or production state was changed.

## Organization media pipeline from 2026-09-04

- Discovery organization administrators can upload and remove a public logo or cover without enabling commerce. Uploads remain RBAC- and CSRF-protected and accept one JPG, PNG or WebP file up to the configured 5 MB limit.
- Sharp decodes the actual image content, rejects unsupported formats and dimensions outside 32–6000 px, applies orientation, bounds logos to 800×800 and covers to 2400×1600 without enlargement, then emits WebP at quality 84.
- Files use random 40-hex immutable keys and atomic temporary-file promotion. PostgreSQL records the uploader, organization, kind, `uploaded` provenance, WebP MIME type, byte size, dimensions and SHA-256. A database failure removes the newly written file; replacing/removing an asset deactivates the prior row and records an audit event.
- Public media requests accept only the generated key shape and serve from the configured media root with immutable caching. Public organization read models select only active valid keys; profile, directory and home templates render the selected media.
- Vitest passed 35 tests with one migration test skipped without `TEST_DATABASE_URL`, including real Sharp conversion, size bounds, fingerprinting, file cleanup, invalid image and SVG rejection. The complete local build passed.
- An isolated PostgreSQL 14 and isolated media directory passed the 16-test discovery browser run. It verified a real PNG upload, 800×600 WebP metadata, SHA-256, public image response, profile rendering, logical removal and the corresponding audit events. The temporary database, media directory and listeners were removed afterward.
- The production service/runbook now requires an explicit persistent `MEDIA_ROOT` under the dedicated production shared storage. Migrated media manifest/copy and backup/restore rehearsals remain required before cutover; no staging or production media changed.
- The read-only `verify:media` command reconciles every media database row with the dedicated filesystem, decodes each file and compares key shape, WebP format, byte size, dimensions and SHA-256 while rejecting missing, orphaned or unexpected entries. The main discovery-data readiness command now fails when this media inventory is not ready.
- Unit coverage includes a valid exact manifest plus missing-hash, metadata-drift, orphan-file and source-transfer mismatch failures. TypeScript, 39 Vitest checks and a clean build passed; the compiled media CLI returned `ready: true` against an empty migrated PostgreSQL 14 database and an existing empty isolated media root.
- The integrated discovery gate was then exercised against a separate migration-003 database containing a successful fingerprinted discovery run, verified administrator, approved organization and active HTTPS external product. It returned `ready: true` with the media root present, then `ready: false` and exit code 1 after only that empty temporary media root was removed. Both temporary databases, roots and listeners were removed. A populated production-snapshot manifest remains unverified until fresh production inventory and backup are authorized.
- The dry-run-first `backfill:media-sha` command addresses legacy media rows that predate stored hashes. It proposes only rows with an absent SHA-256 and refuses to write if any key, file, format, byte-size, dimension, orphan or existing-hash problem is present. `-- --commit` updates guarded NULL hashes in one transaction and records one operational audit event per asset; it never changes files or reconciles other metadata automatically.
- An isolated PostgreSQL 14 run with one generated WebP and a NULL database hash produced an exclusive source manifest, confirmed source-manifest comparison and zero dry-run writes, then made one explicit commit write and one audit event. The final destination verification matched the source manifest exactly. The temporary database, media root, manifest file and listener were removed. Production backfill remains approval-gated and has not run.
- `manifest:media` now produces a deterministic, exclusive-write JSON manifest from a restored source uploads directory. Both `verify:media` and legacy SHA backfill can compare the exact source key set, byte size, dimensions and SHA-256; backfill candidates require a clean source manifest and cannot proceed from destination evidence alone.

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
