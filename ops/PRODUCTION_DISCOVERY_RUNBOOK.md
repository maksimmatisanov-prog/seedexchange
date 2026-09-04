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
   npm run migrate-legacy -- --inventory --scope=discovery
   ```

4. Require equal per-table counts, checksums and the combined `sourceFingerprint`. Investigate any drift before creating a backup.
5. Record approved organizations, verified administrators, active exchanges, active external products, media rows/files, open supplier batches and failed sitemap batches.

## 2. Recoverable backup

1. Back up the Hostinger MySQL database, private uploads and exact deployed PHP release together.
2. Record byte size and SHA-256 for every artifact. Restore all artifacts into an isolated environment and verify representative records and files.
3. Record the current Hostinger DNS address and export the pre-cutover DNS zone when available.
4. Do not proceed when the restore rehearsal, checksums or inventory reconciliation fail.

## 3. Prepare the isolated Node production target

1. Create `/srv/seedexchange-production/{releases,shared/storage}` and a dedicated PostgreSQL database/role. Do not reuse `/srv/seedexchange` staging.
2. Create `shared/production.env` privately with `HOST=127.0.0.1`, `PORT=4200`, `APP_URL=https://seedexchange.online`, `MEDIA_ROOT=/srv/seedexchange-production/shared/storage/media` and all discovery flags disabled. Create that media directory for the `seedexchange` service account with no public write access.
3. Extract the exact reviewed GitHub/CI artifact into an immutable release, verify its SHA-256, run `npm ci`, `npm run check`, `npm test`, `npm run build` and `npm prune --omit=dev`.
4. Apply the ordered PostgreSQL migrations. `/ready` must report the latest migration bundled in the artifact.
5. Copy required first-party media into `shared/storage/media` and verify the complete file manifest by path, size and SHA-256. External Oreshka images remain HTTPS URLs and are not copied.

## 4. Rehearse and import discovery data

1. Against the empty isolated PostgreSQL target, run twice:

   ```bash
   npm run migrate-legacy -- --dry-run --scope=discovery
   ```

2. Require the two dry runs and the final source inventory to have identical counts and fingerprints.
3. After explicit import approval, run exactly once:

   ```bash
   npm run migrate-legacy -- --import --scope=discovery
   npm run generate-sitemap
   npm run verify:media
   npm run verify:discovery-data -- 003_discovery_migration_scope.sql
   ```

4. Both verifiers must report `ready: true`. Any media path/hash/metadata mismatch or orphan file, commerce row, payment capability, non-HTTPS product, pending moderation, failed sitemap state, missing administrator or schema mismatch blocks activation.

## 5. Private runtime acceptance

1. Install the production systemd unit but keep Caddy and DNS unchanged. Start the Node service on loopback port 4200.
2. Verify `/health`, `/ready`, `/`, `/directory`, representative organizations, organization logo/cover media responses, `/marketplace`, representative external products, `/exchange`, `/robots.txt`, `/sitemap.xml`, static assets and a 404 using a local Host header.
3. Confirm cart, cart mutations, checkout and Stripe webhook routes remain unavailable in discovery.
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
