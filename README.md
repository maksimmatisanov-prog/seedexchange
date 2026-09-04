# Seedexchange

New Node.js migration target for [seedexchange.online](https://seedexchange.online), built with Fastify, EJS, TypeScript and PostgreSQL.

## Status

This repository now contains the migration foundation and several end-to-end vertical slices: ordered PostgreSQL migrations, identity/session flows, public catalog and exchange reads, seller moderation workflows, cart/order reservations, disabled-by-default Stripe foundations, conversations, workers, CI and staging release templates. It is still not feature-equivalent with the live PHP/MySQL application and is not approved for production cutover.

See `BRIEF.md` for the product and commercial summary. See `MIGRATION.md` for the audited gap list and migration sequence.

## Local commands

```powershell
npm ci
npm run check
npm run build
npm run migrate
npm test
npm start
```

The default local URL is `http://localhost:4000`. Configuration is read from environment variables or an ignored `.env` file. Never commit credentials.

Discovery-phase data operations are dry-run first:

```powershell
npm run migrate-legacy -- --inventory --scope=discovery
npm run migrate-legacy -- --dry-run --scope=discovery
npm run verify:discovery-rehearsal -- --inventory=<inventory-1.json> --inventory=<inventory-2.json> --dry-run=<dry-run-1.json> --dry-run=<dry-run-2.json>
npm run verify:production-env -- --file=<private-production.env>
npm run verify:discovery-runtime -- --origin=http://127.0.0.1:4200 --migration=003_discovery_migration_scope.sql --organization=/directory/<slug> --product=/product/<slug> --media=/media/<key>.webp
npm run manifest:release -- --root=<absolute-release-directory> --commit=<git-sha> --tree=<git-tree-sha> --output=<absolute-release-directory>/RELEASE.json
npm run verify:release -- --root=<absolute-release-directory> --manifest=<absolute-release-directory>/RELEASE.json --commit=<git-sha>
npm run manifest:discovery-backup -- --mysql-dump=<absolute-file> --uploads-archive=<absolute-file> --legacy-release=<absolute-file> --output=<absolute-new.json>
npm run verify:discovery-backup -- --manifest=<absolute.json> --mysql-dump=<absolute-file> --uploads-archive=<absolute-file> --legacy-release=<absolute-file>
npm run sync:oreshka -- --feed=<https-url-or-local-fixture>
npm run prepare:supplier-batch -- --limit=200
npm run verify:discovery-data
npm run verify:media
npm run backfill:media-sha
npm run manifest:media -- --root=<restored-legacy-uploads> --output=<secure-manifest.json>
```

`migrate-legacy` defaults to the discovery scope. It requires the reviewed legacy tables and semantic columns and reads the source through one repeatable, read-only consistent snapshot; schema drift stops dry-run/import instead of silently dropping fields. Inventory and dry-run accept `--output=<new.json>` to save an exclusive, non-overwriting evidence report; import evidence remains authoritative in PostgreSQL and cannot use this option. `verify:discovery-rehearsal` accepts exactly two inventory and two dry-run reports and requires distinct run IDs plus identical fingerprints, tables, columns and reviewed compatibility. Only `--import` writes migrated rows, supplier commands write only with `--commit`, and batch publication still requires platform-administrator approval. `backfill:media-sha` is read-only by default and writes only with `-- --commit`, after all non-SHA media metadata and the required clean source manifest have matched. The full scope contains commerce history and must not be used for the discovery launch.

## Repository map

- `src/app.ts`: Fastify composition and security headers.
- `src/routes/`: public, identity, commerce, messaging and operations routes.
- `src/db/migrations/`: ordered, checksummed PostgreSQL schema.
- `scripts/`: compiled operational and legacy migration commands.
- `src/templates/` and `public/assets/`: EJS pages and shared design system.
- `test/`: unit, integration and browser checks.
- `ops/`: systemd, Caddy, staging deployment and separately approval-gated production discovery preparation/activation.
- `ops/PRODUCTION_DISCOVERY_RUNBOOK.md`: approval-gated phase-1 production cutover and rollback procedure.
- `MIGRATION.md`: verified evidence, gaps and acceptance gates.
- `BRIEF.md`: concise product brief, current stage, commercial benchmark and recommended work order.

## Legacy comparison source

The current PHP/MySQL implementation is outside this Git repository at `../apps/seedexchange-php`. It is comparison evidence only. Release directories in the parent workspace are snapshots and must not become editable source.
