> Update — 2026-11-03: A separate Royal Flush Supabase project and gated QuickBooks server connection are now installed. The website is still a fictional preview; staff accounts and live Intuit authorization are not complete. See [QUICKBOOKS-SETUP.md](QUICKBOOKS-SETUP.md) for the current state; earlier unapplied/manual-only notes below describe the prior milestone.

# Field communication and billing

The owner requested QuickBooks for both invoices and payments, with Debra approving charges and technicians presenting the approved invoice. The connected company lookup returned Royal Flush Plumbing of the Florida Panhandle. That lookup does not verify an active Payments merchant, API OAuth integration, payment methods, fees or settlement.

## What the team does

1. The assigned technician opens the job and uses **Team notes & photos**. Select progress, before work, after work or office attention; add a note and optionally one photo. Additional photos can be posted as additional updates. Debra can reply in the same job. The owner sees the conversation without changing it. Customers cannot see internal notes or photos.
2. Debra opens **Invoice & payment**, enters descriptions, quantities and prices, and saves a draft. Amounts use integer cents, and PostgreSQL independently calculates the subtotal. Drafts do not charge customers or create QuickBooks transactions.
3. Debra finalizes the actual invoice, customer, tax treatment, fees and payment methods in Royal Flush QuickBooks. After verification, she links its customer-facing HTTPS URL on connect.intuit.com, invoice number and final total to the job. This is a manual handoff, not an automatic accounting integration.
4. The assigned technician can show the approved invoice/payment QR code or copy/open the customer link. The customer pays on QuickBooks using their own phone. Card/bank details do not pass through this app. Present the official invoice and receipt from QuickBooks. Opening or scanning a link never changes payment status in the app.
5. The owner sees job updates and invoice records. Payment status and current balances are **not synchronized** and must be checked in QuickBooks. A payment-confirmed event is not fabricated from a redirect, button press or staff statement.

## Preview behavior

The hosted preview uses fictional work orders. Notes and selected images stay in memory in the current tab, with no uploads, storage writes or messages. Reload clears them. The photo preview decodes supported raster images, limits input to 5 MB / 40 megapixels, resizes to at most 1600 pixels and re-encodes JPEG without the original EXIF metadata or filename. HEIC/SVG/video are not accepted.

Approve preview invoice creates a fictional local record. Its QR contains the text ROYAL_FLUSH_PREVIEW_ONLY_NO_PAYMENT, not a payment address. Printed pages say PREVIEW INVOICE — DO NOT PAY. No invoice, payment link, receipt, email or charge is created in QuickBooks by the preview.

## Security and deployment requirements

- Run the separate field/billing and Storage bootstraps after the main company bootstrap, then the Realtime publication setup. Do not apply any file to the marketplace database. The new settings default off and cannot be changed by web clients.
- job_updates are append-only. Author and job identity, role/assignment, photo pathname and upload size metadata are checked. Corrections use another note. Owner and customer writes are denied. An assigned technician can document completed work; reassignment or deactivation removes access.
- The private Storage bucket allows only JPEG, up to 5 MB. RLS controls inserts and authenticated downloads. There are no public/signed URLs and no overwrite policy. Object names use job/author/update UUIDs. Upload retries reuse only identical bytes; the uploader may delete only unreferenced objects. Posted photos are retained as job evidence. Define authorized retention/deletion and orphan cleanup before launch.
- Client image re-encoding is a convenience, not a server trust boundary. Validate actual uploaded content on the server, review malicious-file handling and set rate/storage quotas before real photo intake. Test image rotation, low connectivity, interrupted uploads, quota failures and physical iOS/Android capture.
- Draft invoice writes and link approval are dispatcher-only. Technicians and customers can see only linked invoices for their authorized jobs. Owners can read all company invoices. Draft invoice records are hidden from customers until Debra approves the link. Approval makes the associated line items and invoice snapshot visible to the authorized customer; Debra must verify they match the actual QuickBooks invoice. Internal notes/photos remain private.
- No service-role key, OAuth refresh token or card data belongs in the browser. The chat's connected QuickBooks credentials are not website credentials. Automatic invoice creation/payment reconciliation would require a separate server integration, restricted OAuth scopes, company binding, idempotency, verified webhooks, reconciliation and refund/dispute handling.
- This version does not verify a pasted invoice's merchant/customer/amount through an API. The office must check them in QuickBooks before approval. The shown total is an office-recorded snapshot, not the outstanding balance. A newly linked record is not a statement that payment was received.
- Before activation, test the actual Supabase REST/Storage/Realtime services with independent staff/customer identities, run advisors, test revocation and concurrent requests, and complete the launch review. PGlite tests model Storage policies; they do not run Supabase's object service.

## Florida and provider review

Florida tax treatment depends on the work and contract structure; do not automatically apply a blanket tax rate to every plumbing service. This app deliberately provides a draft subtotal and leaves the final invoice/tax treatment to the reviewed QuickBooks workflow. The Florida Department of Revenue distinguishes real-property contracting from other sales and installation arrangements: [Sales and Use Tax on Building Contractors](https://floridarevenue.com/Forms_library/gt800007.pdf). Confirm the applicable treatment with the company's accountant and complete the existing Florida service-term/license review before real use.

QuickBooks documents invoice payment-method setup and the need to connect QuickBooks Payments: [Receive and process payments](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/take-process-payments-quickbooks-online/L2vHwwVmh_US_en_US). Merchant onboarding and testing remain outstanding; no pricing or settlement promises are made here.

Storage design reference: [Supabase private buckets and authenticated downloads](https://supabase.com/docs/guides/storage/buckets/fundamentals).
