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

1. Record the current production origin, DNS A/AAAA/CNAME values and TTL, PHP release identifier, MySQL version and migration ledger.
2. Run the legacy production audit and record only sanitized counts and status flags.
3. Run the compiled Node inventory twice against the same read-only MySQL snapshot:

   ```bash
   npm run migrate-legacy -- --inventory --scope=discovery --output=/secure/inventory-1.json
   npm run migrate-legacy -- --inventory --scope=discovery --output=/secure/inventory-2.json
   ```

4. Confirm both outputs report `sourceSnapshot=repeatable-read-read-only`. Require equal ordered column lists, per-table counts, checksums and the combined `sourceFingerprint`. A missing required table/column or any drift blocks the run before creating a backup.
5. Record approved organizations, verified administrators, active exchanges, active external products, media rows/files, open supplier batches and failed sitemap batches.

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

1. Create `/srv/seedexchange-production/{releases,shared/storage}` and a dedicated PostgreSQL database/role. Do not reuse `/srv/seedexchange` staging.
2. Copy `ops/production.env.example` to `shared/production.env`, replace every placeholder privately and restrict it to the service account. Use the dedicated `seedexchange_production` PostgreSQL database and a non-superuser local role; never retain `LEGACY_MYSQL_URL` or Stripe secrets in the runtime file. Validate it before service installation:

   ```bash
   npm run verify:production-env -- --file=/srv/seedexchange-production/shared/production.env
   ```

   It must report `ready: true`. Create the configured media directory for the `seedexchange` service account with no public write access.
3. Extract the exact reviewed GitHub/CI artifact into an immutable release, verify its SHA-256, run `npm ci`, `npm run check`, `npm test`, `npm run build` and `npm prune --omit=dev`.
4. Apply the ordered PostgreSQL migrations. `/ready` must report the latest migration bundled in the artifact.
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

1. Install the production systemd unit but keep Caddy and DNS unchanged. Start the Node service on loopback port 4200.
2. Verify `/health`, `/ready`, `/`, `/directory`, representative organizations, organization logo/cover media responses, `/marketplace`, representative external products, `/exchange`, `/robots.txt`, `/sitemap.xml`, static assets and a 404 using a local Host header.
3. Run the public acceptance suite with `PLAYWRIGHT_EXPECT_LAUNCH_PHASE=discovery` and `PLAYWRIGHT_EXPECT_MIGRATION=003_discovery_migration_scope.sql`. It must confirm all four commerce capability flags are false and that cart add/remove, checkout, Stripe webhook, seller product/shipping/order and ordinary product-moderation mutations return 404 before authentication or CSRF handling.
4. Verify administrator login and batch moderation without creating orders or enabling payment flags.
5. Run responsive and accessibility checks at 375, 768 and 1440 px. Inspect logs and resource usage.

## 6. Cutover and rollback

1. Obtain separate explicit approval for Caddy and DNS changes.
2. Install the reviewed production Caddy block, validate and reload Caddy. Change root and `www` DNS to the VPS only after loopback acceptance passes.
3. Verify authoritative DNS, TLS, canonical URLs, live pages, external links, sitemap, logs and the discovery capability report from at least two external resolvers.
4. If a blocking fault appears, restore the recorded Hostinger DNS values and keep the PHP release/database/uploads unchanged. Do not attempt a partial data rollback.
5. Observe errors, latency, database connections, sitemap, external links and moderation for 24 hours before accepting phase 1.

## Phase 2 remains separate

Internal marketplace and Stripe require a new approved migration/data scope, test-mode Connect onboarding, checkout/webhook idempotency, refunds, disputes, transfer reversal, payout holds, accounting and a separate production activation. Phase 1 acceptance does not authorize any of those capabilities.
