# Production discovery cutover

This runbook covers only phase 1: directory, organizations, exchange and HTTPS external offers. It does not authorize a production change. Every backup, import, service activation, Caddy change and DNS change requires explicit owner approval at that step.

## Invariants

- `LAUNCH_PHASE=discovery`.
- `CONNECT_ENABLED=0`, `MARKETPLACE_PAYMENTS_ENABLED=0`, `PAYOUT_WORKER_ENABLED=0`.
- Production uses its own `/srv/seedexchange-production`, PostgreSQL role/database, environment file, storage and service. It never reuses staging data or credentials.
- The legacy Hostinger release and MySQL database remain intact until the observation window is accepted.
- Only `npm run migrate-legacy -- --import --scope=discovery` may populate the phase-1 target.
- Internal marketplace products, carts, orders, reservations, Stripe events, transfers and reviews are absent from the phase-1 database.

## 1. Read-only inventory

1. From the exact reviewed checkout, verify that the VPS is still a clean isolated target:

   ```bash
   ssh root@<approved-vps-ip> 'bash -s -- --expect=clean' < ops/verify-production-host.sh
   ```

   Require `ready=true`. The preflight is read-only and checks Node 24, the service account, PostgreSQL, Caddy import, staging isolation, port `4200`, the dedicated database/role and the exact five production units. An unexpected production resource or a missing prerequisite blocks preparation; do not repair it inside the inventory step.
2. Record the current production origin, DNS A/AAAA/CNAME values and TTL, PHP release identifier, MySQL version and migration ledger.
3. Run the legacy production audit and record only sanitized counts and status flags.
4. Run the compiled Node inventory twice against the same read-only MySQL snapshot:

   ```bash
   npm run migrate-legacy -- --inventory --scope=discovery --output=/secure/inventory-1.json
   npm run migrate-legacy -- --inventory --scope=discovery --output=/secure/inventory-2.json
   ```

5. Confirm both outputs report `sourceSnapshot=repeatable-read-read-only`. Require equal ordered column lists, per-table counts, checksums and the combined `sourceFingerprint`. A missing required table/column or any drift blocks the run before creating a backup.
6. Record approved organizations, verified administrators, active exchanges, active external products, media rows/files, open supplier batches and failed sitemap batches.

## 2. Recoverable backup

1. Back up the Hostinger MySQL database, private uploads and exact deployed PHP release together.
2. Package the database dump, private uploads and exact PHP release as three distinct non-empty regular files. Create an exclusive manifest without reading their contents into application memory:

   ```bash
   npm run manifest:discovery-backup -- --mysql-dump=/secure/database.sql.gz --uploads-archive=/secure/uploads.tar.gz --legacy-release=/secure/legacy-release.tar.gz --output=/secure/discovery-backup-manifest.json
   ```

3. Copy the three artifacts and manifest into the isolated restore environment, then verify their names, byte sizes and SHA-256 before extraction:

   ```bash
   npm run verify:discovery-backup -- --manifest=/secure/discovery-backup-manifest.json --mysql-dump=/secure/database.sql.gz --uploads-archive=/secure/uploads.tar.gz --legacy-release=/secure/legacy-release.tar.gz
   ```

4. Require `ready: true` and record the manifest's own SHA-256. Restore all artifacts and verify representative database records, uploads and the PHP release separately; artifact integrity alone does not prove a successful restore.
5. Record the current Hostinger DNS address and export the pre-cutover DNS zone when available.
6. Do not proceed when the restore rehearsal, checksums or inventory reconciliation fail.

## 3. Prepare the isolated Node production target

1. After a distinct production-foundation approval, create a root-owned mode-`0600` file under `/secure` containing only a new 32–128 character URL-safe database password. From the exact reviewed workstation checkout, stream the guarded script to the VPS:

   ```bash
   ssh root@<approved-vps-ip> 'SEEDX_PRODUCTION_FOUNDATION_APPROVED=YES bash -s -- /secure/root-only-db-password' < ops/prepare-production-foundation.sh
   ```

   The script rechecks the clean host state, creates only `/srv/seedexchange-production`, the login role/database `seedexchange_production` and the persistent storage directories, then proves a least-privilege TCP password login. Any failure removes only resources created by that run. It does not create the runtime environment, install a release or unit, import data, start a service, change Caddy/DNS or enable payments. Securely remove the one-purpose password file only after its value has been installed into the private runtime environment and the foundation/DB gates pass.
2. Copy `ops/production.env.example` to a separate root-only file under `/secure`, replace every placeholder privately, insert the same database password without re-encoding (the foundation script accepts URL-safe characters only), then install it as `/srv/seedexchange-production/shared/production.env` owned by `root:seedexchange` with mode `0640`. Use the dedicated login role and database named `seedexchange_production`; the role must have no superuser, role/database creation, replication or row-security-bypass attributes. Connect only over `127.0.0.1:5432`; do not rely on the staging service account's Unix peer identity. Never retain `LEGACY_MYSQL_URL` or Stripe secrets in the runtime file. Validate it before service installation:

   ```bash
   ssh root@<approved-vps-ip> 'bash -s -- --expect=foundation' < ops/verify-production-host.sh
   npm run verify:production-env -- --file=/srv/seedexchange-production/shared/production.env
   ```

   It must report `ready: true`. Create the configured media directory for the `seedexchange` service account with no public write access. The later preparation script also opens a read-only connection through this environment and requires the actual database, current role, owner, loopback server address and least-privilege attributes to match before SMTP verification or schema migration.
3. Select one reviewed commit merged to `master` whose CI passed TypeScript, PostgreSQL-backed tests, build, production dependency audit and Chromium acceptance. Production artifacts are not emitted for pull requests or feature-branch pushes. Download only its `seedexchange-production-discovery-<commit>` artifact. It contains a tar archive, SHA-256 sidecar and an internal `RELEASE.json` that fingerprints every allowlisted runtime file and pins the Git commit, tree, Node major and newest migration. Record the GitHub artifact digest, archive SHA-256 and commit as one approval set.
4. After explicit preparation approval, use the exact approved archive values:

   ```bash
   SEEDX_PRODUCTION_DISCOVERY_PREPARE_APPROVED=YES bash ops/deploy-production-discovery.sh /secure/seedexchange-<commit>.tar.gz <sha256> <40-char-commit>
   ```

   The script rejects unsafe archive paths and file types, verifies the outer SHA-256 and internal file manifest before `npm ci`, validates the private production environment and performs an SMTP connection/authentication preflight without sending a message. Only then does it apply ordered PostgreSQL schema migrations and leave the release read-only. A failed or timed-out SMTP preflight blocks preparation and emits only a safe failure code, never the host, user, password or sender address. The script does not switch `current`, start the service, import data, or change Caddy/DNS.
5. From the restored legacy uploads, generate a source manifest with `npm run manifest:media -- --root=/absolute/restored/uploads --output=/secure/source-media-manifest.json`; record the manifest file's own SHA-256 with the backup evidence. Then copy required first-party media into `shared/storage/media`. External Oreshka images remain HTTPS URLs and are not copied.

## 4. Rehearse and import discovery data

1. Against the empty isolated PostgreSQL target, run twice:

   ```bash
   npm run migrate-legacy -- --dry-run --scope=discovery --output=/secure/dry-run-1.json
   npm run migrate-legacy -- --dry-run --scope=discovery --output=/secure/dry-run-2.json
   ```

2. Verify the four exclusive reports offline:

   ```bash
   npm run verify:discovery-rehearsal -- --inventory=/secure/inventory-1.json --inventory=/secure/inventory-2.json --dry-run=/secure/dry-run-1.json --dry-run=/secure/dry-run-2.json
   ```

   It must report `ready: true`, four distinct command `runId` values and one fingerprint. Review every `targetOnlyColumns` entry; it must match the built-in allowlist (`media_assets.sha256` and `products.publication_batch_id`). Any source/schema/count/checksum/compatibility drift blocks import.
   Confirm that `users` and `auth_tokens` are both present in the discovery inventory. Hashed verification/reset tokens are migrated so already-issued links can survive cutover; PHP sessions and authentication rate-limit buckets are intentionally excluded, so every signed-in user must authenticate again on Node.
3. After explicit import approval, run exactly once:

   ```bash
   npm run migrate-legacy -- --import --scope=discovery
   npm run generate-sitemap
   npm run backfill:media-sha -- --expected=/secure/source-media-manifest.json
   ```

4. Review the dry-run SHA candidates. Any path, format, size, dimension, orphan or existing-hash mismatch blocks the run. After a separate explicit media-metadata approval, run:

   ```bash
   npm run backfill:media-sha -- --expected=/secure/source-media-manifest.json --commit
   npm run verify:media -- --expected=/secure/source-media-manifest.json
   npm run verify:discovery-data -- 003_discovery_migration_scope.sql
   ```

5. Both verifiers must report `ready: true`. Any media path/hash/metadata mismatch or orphan file, commerce row, payment capability, non-HTTPS product, pending moderation, failed sitemap state, missing administrator or schema mismatch blocks activation.

## 5. Private runtime acceptance

1. After explicit unit-install approval, copy the five exact files from the prepared release's `ops/systemd/production/` directory to `/etc/systemd/system/`, preserving their names and mode `0644`. Run `systemd-analyze verify` on all five installed files, then `systemctl daemon-reload`. Keep the web service and both timers stopped. From the reviewed workstation checkout, run `ssh root@<approved-vps-ip> 'bash -s -- --expect=units-installed' < ops/verify-production-host.sh` and require `ready=true`. The bundle contains only the production web service, outbox delivery and sitemap generation; there is deliberately no production marketplace worker. Record one approved organization slug, external product slug and first-party media key from the verified migration. Activation rejects modified unit files and any systemd drop-ins.
2. After separate explicit activation approval, activate only the prepared commit. The command re-verifies the release, environment, source media manifest and discovery database before switching `current`; after restart it requires readiness plus the full read-only runtime gate. A failed restart or gate restores the previous application symlink and service (or stops the first deployment):

   ```bash
   SEEDX_PRODUCTION_DISCOVERY_ACTIVATE_APPROVED=YES bash ops/activate-production-discovery.sh <40-char-commit> 003_discovery_migration_scope.sql /secure/source-media-manifest.json /directory/<slug> /product/<slug> /media/<key>.webp
   ```

   The runtime portion sends only GET requests with `Host: seedexchange.online`. It requires production security headers, canonical URLs, the discovery payment notice, an external-only product action, sitemap membership and non-empty WebP media. It then runs a bounded loopback-only smoke of 72 GET requests at concurrency 6 across health, readiness and representative discovery routes; every response must be 200 and overall p95 must be at most 750 ms. Together with the preceding probes this remains below the application's 100-request rate limit. This is a regression gate, not a capacity claim or replacement for staging load evidence. Only after both gates pass does activation run one sitemap/outbox cycle and a sanitized operational observation. That observation must confirm the migration and dedicated database, safe connection capacity, no long-running or idle-in-transaction sessions, no failed/stale outbox work and a fresh sitemap containing the representative organization and product. The activation then enables the web service plus the two production timers. It does not install or run a marketplace worker and does not change Caddy or DNS.
3. Run the public acceptance suite with `PLAYWRIGHT_EXPECT_LAUNCH_PHASE=discovery` and `PLAYWRIGHT_EXPECT_MIGRATION=003_discovery_migration_scope.sql`. It must confirm all four commerce capability flags are false and that cart add/remove, checkout, Stripe webhook, seller product/shipping/order and ordinary product-moderation mutations return 404 before authentication or CSRF handling.
4. Verify administrator login and batch moderation without creating orders or enabling payment flags.
5. Run responsive and accessibility checks at 375, 768 and 1440 px. Inspect logs and resource usage.

## 6. Cutover and rollback

1. Obtain separate explicit approvals for Caddy and DNS changes. The current VPS Caddyfile imports `/etc/caddy/sites-enabled/*.caddy`; do not edit the shared Caddyfile or the independent staging fragment.
2. After Caddy approval, install only the release-manifested production fragment. The script re-verifies the active release, Node readiness, operational observation, standalone fragment and complete Caddy configuration before reload. It restores a newly installed fragment if validation, reload or the local HTTP-to-HTTPS check fails, and it does not change DNS:

   ```bash
   SEEDX_PRODUCTION_CADDY_APPROVED=YES bash /srv/seedexchange-production/current/ops/caddy/activate-production-caddy.sh <40-char-commit> 003_discovery_migration_scope.sql /directory/<slug> /product/<slug>
   ```

3. After separate DNS approval, change root and `www` A records to the recorded VPS address. The pre-cutover zone currently also resolves AAAA records: replace them with one explicitly approved VPS IPv6 address or remove them as part of the same approved change; never leave legacy IPv6 answers active beside the new A record. Hostinger and hPanel operations are Chrome-only. Do not remove or modify the legacy PHP release, MySQL database or uploads.
4. Run the sanitized public cutover verifier using the approved VPS address and representative paths. Omit `--expected-ipv6` only when the approved zone intentionally has no AAAA records; otherwise pass the single approved public IPv6 address:

   ```bash
   npm run verify:public-cutover -- --expected-ipv4=<approved-vps-ip> --migration=003_discovery_migration_scope.sql --organization=/directory/<slug> --product=/product/<slug> --media=/media/<key>.webp --output=/secure/public-cutover-<timestamp>.json
   ```

   It requires exact A/AAAA results for root and `www` through Cloudflare and Google DNS, valid TLS 1.2/1.3, the canonical `www` redirect, discovery-only health/readiness, the approved migration, representative organization/product/media/sitemap output and a public 404 for `/cart`. It sends only GET requests and records no bodies. Record the report SHA-256, then separately run public Playwright, inspect external offer destinations and review Caddy/application logs.
5. If a blocking fault appears, restore the recorded Hostinger DNS values first and wait until the selected authoritative/external resolvers return the legacy values. After separate Caddy-rollback approval, remove only the exact release-matched production fragment; the rollback script restores it if the remaining shared Caddy configuration cannot validate or reload:

   ```bash
   SEEDX_PRODUCTION_CADDY_ROLLBACK_APPROVED=YES bash /srv/seedexchange-production/releases/<40-char-commit>/ops/caddy/rollback-production-caddy.sh <40-char-commit>
   ```

   Do not attempt a partial data rollback.
6. Repeat the sanitized observation immediately after public cutover, periodically during the window and at or after 24 hours. Use a new output path for each run and record the emitted report SHA-256 with the operator log:

   ```bash
   npm run verify:production-observation -- --migration=003_discovery_migration_scope.sql --organization=/directory/<slug> --product=/product/<slug> --output=/secure/observation-<timestamp>.json
   ```

   A report contains operational counts and status only, not connection strings, recipient addresses, message bodies or queries. `ready: false`, a non-zero exit, application errors, latency regression, invalid external links or moderation failure blocks phase-1 acceptance and triggers the approved rollback decision.

## Phase 2 remains separate

Internal marketplace and Stripe require a new approved migration/data scope, test-mode Connect onboarding, checkout/webhook idempotency, refunds, disputes, transfer reversal, payout holds, accounting and a separate production activation. Phase 1 acceptance does not authorize any of those capabilities.
