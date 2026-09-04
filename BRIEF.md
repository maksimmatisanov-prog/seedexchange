# Seedexchange project brief

Status date: 2026-09-04.

## Product

Seedexchange is a public directory, non-commercial exchange and multi-vendor marketplace for seed banks, botanic gardens, nurseries, growers, shops and collectors.

The product is positioned as a living seed archive rather than a generic shop. A seed record should make its origin understandable through an approved organization, botanical identity, source information, quantity, availability and a traceable moderation history. Public copy should prefer plain phrases such as "known origin" or "clear source". The specialist terms "provenance" and "accession" remain useful where the audience expects them.

## Audiences and core paths

- Visitors find seeds with a clear source and follow approved external seller links during phase 1.
- Organizations publish durable public profiles, official contact channels, reviewed catalog records and profile media.
- Collectors arrange non-commercial exchanges or donations directly.
- Sellers submit internal marketplace products and fulfil orders through protected workflows only in phase 2.
- Platform administrators approve organizations and products, review reports and handle delivery cases.

## Current commercial model

- Directory, profiles, listings and non-commercial exchange: free.
- Subscription fee: none at launch.
- Listing fee: none at launch.
- Standard marketplace commission: 10% of the product subtotal.
- Seller shipping charge: excluded from the platform commission.
- Founding Organizations: the first 50 approved organizations receive a permanent badge. An eligible Founder seller receives a 7% commission rate for 12 months from first activation, unless its configured standard rate is already lower.
- Stripe processing, refund and dispute cost allocation: not yet approved. Payments must remain disabled until this is part of the accepted seller agreement.

## Marketplace fee benchmark

Fee snapshot checked on 2026-09-04. Competitor rates vary by country, category, seller plan, advertising and payment method.

| Marketplace | Published base selling cost | Important additions |
| --- | --- | --- |
| Seedexchange draft | 10% of product subtotal | Payment processing allocation is still undecided; no listing or subscription fee at launch |
| Etsy | 6.5% transaction fee | USD 0.20 listing fee, payment processing and possible regulatory or advertising fees |
| eBay US | 13.6% for most categories up to the published threshold | Per-order fee, category/store differences and optional promotion costs |
| Amazon US Lawn & Garden | 15% referral fee | Minimum referral fee and Individual or Professional selling-plan cost |

Primary references:

- [Etsy seller fees](https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy?segment=selling)
- [eBay selling fees](https://www.ebay.com/help/selling-fees/selling/selling-fees?id=4822)
- [Amazon selling pricing](https://sell.amazon.com/pricing)

The proposed 10% rate is below the cited eBay and Amazon base rates and above Etsy's transaction fee alone. It can only be described as competitive after Stripe costs and refund/dispute allocation are included in a worked seller example.

## Current stage

The Fastify, EJS, TypeScript and PostgreSQL application is a migration target. Production remains on the legacy PHP/MySQL application, and the existing closed staging release is older than the current local discovery branch. The local application includes identity and RBAC, public discovery, organization profiles and official channels, exchange/donation management, guarded Oreshka external offers, secure profile media, messages, and commerce foundations kept behind the second-phase boundary. Marketplace payments remain disabled by default. Production readiness fails closed when first-party media files, PostgreSQL metadata and SHA-256 do not reconcile or when an external product destination/image is not a syntactically public HTTPS URL without embedded credentials. Public catalog reads independently hide an external product with an unsafe destination and omit an unsafe image. The discovery ETL now requires the reviewed legacy tables and columns, inventories the source schema in its fingerprint and reads all source rows from one repeatable, read-only snapshot. Production preparation also verifies SMTP connection and authentication without sending mail or exposing credentials. The guarded production activation performs read-only runtime, bounded loopback load and operational observation gates before enabling timers; a failed activation explicitly restarts the previous release process after restoring its symlink. The production Caddy fragment and its activation/rollback scripts are part of the same immutable release, while DNS remains a distinct owner-approved operation. A separate public verifier records two-resolver DNS, TLS, redirect and discovery-boundary evidence after cutover without sending mutations or retaining response bodies.

The release contract has two explicit phases:

- `LAUNCH_PHASE=discovery`: only approved external offers with HTTPS source links are public. Cart, checkout, Stripe webhook processing and marketplace worker mutations are unavailable. Connect, marketplace payments and payouts must all remain disabled.
- `LAUNCH_PHASE=commerce`: internal marketplace records become public only when Stripe Connect and marketplace payments are explicitly enabled together. Payments are required before payouts.

This is not approved for production cutover. `MIGRATION.md` is the source of truth for verified evidence and remaining acceptance gates.

## Verified status snapshot

As of 2026-09-04:

- The working branch is `codex/discovery-launch` and has not been pushed. The latest application change is `4676b5c`; later local commits update operational evidence and gates only.
- Local TypeScript, the clean build and 101 Vitest checks pass. One PostgreSQL-backed migration test is skipped when `TEST_DATABASE_URL` is not configured. Chromium public acceptance most recently passed 13 checks with two deliberate duplicate-viewport skips.
- The immutable discovery release manifest verifies 302 allowlisted files, pins migration `003_discovery_migration_scope.sql` and contains no runtime `node_modules`.
- Read-only public checks still identify the Hostinger PHP application. DNS still resolves through the existing Hostinger/CDN addresses, not the intended VPS cutover address.
- The repository includes a read-only host preflight for the clean, foundation and units-installed stages. Its current VPS `--expect=clean` run returned `ready=true`, confirming Node 24, the `seedexchange` service account, active PostgreSQL and Caddy, the existing isolated staging root `/srv/seedexchange`, a valid Caddy site import and a free production loopback port `4200`.
- The dedicated production root `/srv/seedexchange-production`, PostgreSQL database/role `seedexchange_production`, private production environment and all five production systemd units do not yet exist. The environment contract now requires that dedicated non-elevated login role over local TCP with a private password; it rejects accidental staging peer-role reuse. No production preparation has started.
- No production database, files, services, Caddy configuration, DNS, traffic, payment flags or marketplace state were changed while producing this snapshot.

## Decisions required before payments

1. Which legal entity operates the marketplace and which seller agreement applies.
2. Who pays Stripe processing, refund, dispute, Connect and payout costs.
3. Which countries, species and seed categories are prohibited or require documents.
4. What evidence sellers must provide for identity, origin, quantity and legal distribution.
5. Seller dispatch and response service levels, cancellation rules and buyer remedies.
6. Delivery-case evidence, review authority, refund outcomes and appeal path.
7. Tax, privacy, retention and support responsibilities by operating region.

These are owner and legal decisions. Code must implement the approved policy rather than define it implicitly.

## Recommended work order

1. Review the local discovery branch and explicitly approve `git push origin codex/discovery-launch`. A push publishes code only; it does not deploy or change production.
2. After CI succeeds and a reviewed commit is merged to `master`, deploy that immutable discovery release to the closed staging endpoint, configure persistent media storage and repeat public, RBAC, organization, exchange and upload acceptance.
3. Take a fresh read-only legacy production inventory and approve the field-by-field discovery import contract.
4. Run two complete production-snapshot discovery migration rehearsals, save two inventory and two dry-run reports with distinct run IDs, pass the offline rehearsal verifier, and include database parity, media manifests/SHA-256, sitemap output and restore evidence.
5. Grant a separate production-foundation approval before creating `/srv/seedexchange-production`, the dedicated non-superuser database/role and the private environment. This approval must not include import, service activation, Caddy, DNS or payments.
6. Complete phase-1 operational acceptance: administrator moderation, SMTP preflight, monitoring, bounded performance evidence, backup/restore and rollback drill. Install and activate production units only under their later, separate approvals.
7. Make separate owner decisions on production Caddy and DNS cutover, then run public verification and the observation window.
8. Only after phase 1 is accepted, finish the deferred community screens and approve the legal/payment policy for phase 2.
9. Accept Stripe Connect, checkout, refunds, disputes, reversals and payout behavior in test mode before any commerce activation request.
