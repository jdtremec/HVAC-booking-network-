# Royal Flush QuickBooks connection

The website connection is implemented but is **not authorized for live accounting yet**. The ChatGPT QuickBooks connector is a separate connection and its credentials are never copied into this application. No real invoice, payment, customer import or email has been created by this build.

## Installed infrastructure

Dedicated Supabase project: `royal-flush-service`, project ref `ygccqwadtfneqcvzclqw`, US East. This is separate from `home-services-dispatch` and its Auth users. The service, field/billing, private photo bucket and QuickBooks schemas are installed. All intake, photo, billing, payment and QuickBooks launch switches remain false. The `royal-flush-qbo` Edge Function is deployed with application-level authentication; the callback and webhook have their own state/signature checks. A live unauthenticated request was rejected.

The published website remains a fictional, owner-private preview. Staff accounts, verified email delivery, final terms, Intuit production authorization and merchant payment verification are still required before switching to a live build.

## Data flow and authority

QuickBooks supplies the office's customer contacts and service catalog. The dispatcher can copy a selected customer's contact/address into a request, but must confirm the actual Florida service address. Data is fetched in bounded pages. Inactive catalog entries remain inactive; no customer or service is silently created or merged.

Only the dispatcher may create or link job invoices and release an approved invoice to the assigned technician. The owner monitors without approving billing or assignments. The owner separately manages the company connection. Customer and service caches are office-only; technicians see only approved invoices on their assigned jobs. Photos and internal messages remain in the service app.

Creating an invoice freezes the reviewed draft and stores a durable request identifier before sending it to QuickBooks. A lost/ambiguous response locks the attempt for office reconciliation. It is never blindly retried. The dispatcher can select the verified existing invoice to resolve it. Incorrect reservations require administrator investigation; there is no unsafe reset button.

The dispatcher maps each draft line to an active QuickBooks service/non-inventory item and explicitly chooses its tax treatment. QuickBooks calculates the final total. A second review releases that invoice to the technician. Invoice emails are not sent automatically. Online payment is on QuickBooks' hosted invoice page only, and requires verified merchant settings. This application never captures card or bank details or directly charges a payment method.

Balances include a last-checked timestamp. Zero balance can reflect credits or a void, so it is not labeled proof of payment. Material invoice-content changes withdraw local approval. Webhooks are authenticated hints; canonical invoice reads determine financial state. Receipts, refunds, voids and tax decisions remain in QuickBooks.

## Intuit setup

Create the company's app in its owner-controlled Intuit developer workspace. Use only the approved $0 Builder tier unless a separate paid upgrade is approved. Complete Intuit's required production assessment honestly; do not attest that untested features or incomplete policies are ready.

App name: `Royal Flush Service Department`.

Register these HTTPS endpoints for the applicable development/production environment:

- OAuth redirect: `https://ygccqwadtfneqcvzclqw.supabase.co/functions/v1/royal-flush-qbo/callback`
- Webhook: `https://ygccqwadtfneqcvzclqw.supabase.co/functions/v1/royal-flush-qbo/webhook`
- Accounting scope: `com.intuit.quickbooks.accounting`

Use an Intuit test company first. Do not authorize a sandbox against the real company. Production requires separately issued production credentials, the correct Royal Flush company ID, live owner consent, and merchant verification. This implementation uses hosted invoice payment links, not the direct Payments charge API.

## Server configuration

Store values in **Supabase Edge Function secrets**, never in Git, browser code, the Sites manifest, a chat message or a source archive:

| Key | Value |
| --- | --- |
| `RF_APP_ORIGIN` | `https://royal-flush-service-preview.d5hjfhvw6m.chatgpt.site` (change deliberately if the staff origin changes) |
| `QBO_ENVIRONMENT` | `sandbox` for testing, `production` only after approval |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | Matching credentials from the Intuit app |
| `QBO_REALM_ID` | Exact approved QuickBooks company ID; callback must match it |
| `QBO_TOKEN_KEY` | Cryptographically random 32-byte AES key, base64 encoded; back up in the owner's secret manager |
| `QBO_WEBHOOK_VERIFIER` | Matching Intuit environment's webhook verifier |
| `RF_QBO_CRON_SECRET` | Separate random secret for scheduled reconciliation |
| `QBO_ALLOW_CARD` / `QBO_ALLOW_ACH` | `true` only for merchant-verified payment methods; otherwise absent/false |
| `SUPABASE_SECRET_KEY` | Preferred server-only Supabase secret key; runtime legacy service key is the compatibility fallback |

OAuth access/refresh tokens are encrypted with AES-GCM and company-bound additional authenticated data. Server-only tables have RLS and no client grants/policies. The advisor's four `rls_enabled_no_policy` informational findings are intentional deny-by-default tables, not missing access grants. Never add public policies to clear those notices.

Deploy all files in `server/` as `royal-flush-qbo`. `verify_jwt=false` is required for Intuit callbacks/webhooks; normal operations still call Supabase Auth `getUser` and check active membership, origin and role. Only server code can reserve invoice requests or hold the per-company lease. Revoke member access through the membership table immediately when needed.

Expose only `royal_flush` through Supabase's Data API in addition to required default schemas. Do not expose `rf_private`. Realtime should contain the six service tables plus `qbo_connection` and `qbo_job_invoices`; never publish secret/request/state tables.

## Reconciliation and launch tests

The office can explicitly refresh QuickBooks. For unattended updates, configure a trusted scheduler to POST to `/functions/v1/royal-flush-qbo/reconcile` using `Authorization: Bearer <RF_QBO_CRON_SECRET>`. Keep that secret in the scheduler's protected secret store. No recurring schedule is configured by this build. Each pass fetches one customer page, one item page and up to ten linked invoices; additional passes finish larger catalogs. Rotate all invoices, including settled invoices, so reversals are picked up. Webhook delivery is not a guarantee of immediate synchronization.

Before allowing real use, verify: owner/dispatcher/technician Auth accounts, approved Sites audience, production mail delivery and account recovery, authenticated multi-session isolation and reassignment, server photo-content validation, retained-photo privacy/retention, actual Supabase REST/Storage/Reatime behavior, Intuit sandbox OAuth and token refresh, wrong-company rejection, API throttling/disconnect handling, full catalog pagination, tax totals and payment-link availability, duplicate/timeout recovery, invoice approval withdrawal, merchant payment and refund reconciliation, cron execution and recovery, backups and restore.

Current automated tests use fictional provider responses and local PostgreSQL. They do not prove Intuit production access, actual payment settlement, physical-phone camera behavior or background notification delivery. Keep launch switches closed until those checks and the company's Florida service/privacy terms are completed.

Official references: [Intuit Builder and fees](https://static.developer.intuit.com/output_html/qbo/docs/get-started/partner-faq.html), [Invoice API](https://developer.intuit.com/docs/api/accounting/invoice), [webhook validation](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html), [Supabase Auth architecture](https://supabase.com/docs/guides/auth/architecture).
