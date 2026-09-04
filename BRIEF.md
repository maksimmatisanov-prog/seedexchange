# Seedexchange project brief

Status date: 2026-09-04.

## Product

Seedexchange is a public directory, non-commercial exchange and multi-vendor marketplace for seed banks, botanic gardens, nurseries, growers, shops and collectors.

The product is positioned as a living seed archive rather than a generic shop. A seed record should make its origin understandable through an approved organization, botanical identity, source information, quantity, availability and a traceable moderation history. Public copy should prefer plain phrases such as "known origin" or "clear source". The specialist terms "provenance" and "accession" remain useful where the audience expects them.

## Audiences and core paths

- Buyers find seeds with a clear source and seller-specific shipping.
- Organizations publish durable public profiles and reviewed catalog records.
- Collectors arrange non-commercial exchanges or donations directly.
- Sellers submit products and fulfil orders through protected workflows.
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

The Fastify, EJS, TypeScript and PostgreSQL application is a closed staging migration target. Production remains on the legacy PHP/MySQL application. The new application includes identity and RBAC, public discovery, seller and moderation writes, cart and order foundations, messages, workers, tracked fulfilment and delivery cases. Marketplace payments remain disabled by default.

The release contract has two explicit phases:

- `LAUNCH_PHASE=discovery`: only approved external offers with HTTPS source links are public. Cart, checkout, Stripe webhook processing and marketplace worker mutations are unavailable. Connect, marketplace payments and payouts must all remain disabled.
- `LAUNCH_PHASE=commerce`: internal marketplace records become public only when Stripe Connect and marketplace payments are explicitly enabled together. Payments are required before payouts.

This is not approved for production cutover. `MIGRATION.md` is the source of truth for verified evidence and remaining acceptance gates.

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

1. Finish and review the local homepage change, reconcile status documentation and keep the release local.
2. Complete image upload, resize, storage and source-provenance handling.
3. Finish reviews, reports, collections/journal and notification interaction screens.
4. Run seeded buyer, seller and administrator acceptance on closed staging, including SMTP, monitoring, load and backup/restore evidence.
5. Take a fresh read-only legacy inventory and approve a field-by-field import contract.
6. Run two complete production-snapshot migration rehearsals and verify media hashes.
7. Accept Stripe Connect, refunds, disputes, reversals and payout behavior in test mode.
8. Prepare an explicit cutover and rollback decision. Do not change production traffic without owner approval.
