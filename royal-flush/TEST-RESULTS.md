> Update — 2026-11-03: A separate Royal Flush Supabase project and gated QuickBooks server connection are now installed. The website is still a fictional preview; staff accounts and live Intuit authorization are not complete. See [QUICKBOOKS-SETUP.md](QUICKBOOKS-SETUP.md) for the current state; earlier unapplied/manual-only notes below describe the prior milestone.

# Verification — November 3, 2026

## Passed

- Preview built with pinned dependencies/lockfile.
- Database/domain tests: embedded PostgreSQL (PGlite), simulated Supabase Auth roles/claims.
- Marketplace-install refusal; default closed intake; no client launch-control changes; anonymous/unprovisioned users denied; no self-enrollment/promotion; customer ownership enforced; cross-customer/unassigned-technician reads denied.
- Active company technicians only; overlapping appointments rejected; protected fields/skipped statuses rejected; stale UI update returns no row; event forgery/deletion/delivery edits denied.
- Sequential completion produces atomic audit/outbox records; revoked staff immediately lose access.
- Central Time winter/summer conversion; invalid, missing and repeated DST times rejected.
- Chrome workflow at **320, 390, 768 and 1440 pixels**: sample intake → assignment → technician travel/work/completion → disabled notification history → reload reset.
- No horizontal overflow, uncaught browser errors, external requests or local/session-storage writes in preview.
- Screenshots reviewed at 390 and 1440 pixels; owner monitoring view reviewed at 390 pixels.
- Owner read-only restrictions tested in the preview and directly against PostgreSQL; dispatcher writes remain allowed. Owner membership deactivation removes read access.
- Monitor tests simulate change events, missed events, polling, offline/online recovery, sleeping-tab return, stale status, in-flight changes, sign-out cleanup and access removal.
- Optional Realtime publication setup verified against embedded PostgreSQL: fails if the publication is absent; adds only six company tables; succeeds on repeat without duplicate additions.

## Limits

- Edge failed to launch in the Windows execution environment; Chrome completed the test.
- Viewports are not physical iPhone Safari/Android tests.
- No dedicated live project, actual Auth sign-in, Supabase REST integration or cross-device WebSocket delivery tested. Monitor connection tests use an injected fake transport; actual latency is unverified.
- PGlite does not test simultaneous database sessions. Hosted concurrency and API permission checks remain required.
- No SMS/email, payments, invoicing, real customer onboarding, emergency response or legal approval tested/activated.
- Marketplace audited, not repaired or fully revalidated.

Reproduce with npm ci, npm run build, npm test and installed Chrome. The browser test owns port 4173 and stops its server afterward.


Owner-monitoring combined run: 22 tests passed, zero failures. After adding publication and owner-revocation coverage, the targeted database run passed all 11 checks (10 overlap with the combined run). No application code changed after the combined run.

## Field communication and QuickBooks handoff update

Combined run: 34 tests passed, zero failures. Targeted mobile browser checks were repeated after the final job-shortcut and invoice-display changes.

- At 320, 390, 768 and 1440 pixels: technician completes a job, rejects an unsupported attachment, posts an escaped note with a re-encoded photo, views the private photo, receives an office reply, and the dispatcher prepares/approves an invoice draft and opens the inert payment QR screen. Owner visibility, customer note/photo exclusion, printing, no network egress and no browser persistence checked.
- Embedded PostgreSQL tests: staff/assignment boundaries, immutable notes/photos, author/path spoofing, upload and billing launch gates, owner read-only access, customer draft exclusion, server-calculated invoice totals, provider URL validation, mandatory approval details, no client paid-status writes, stale updates, and revocation/reassignment. Storage policies run against a fixture schema; the actual Supabase object service was not tested.
- Draft money calculations reject fractions/negative/excessive values; URLs reject alternate hosts, lookalikes, credentials and unsafe protocols. Preview invoice approval never creates a real payment address or paid status.
- The connected QuickBooks company was identified by a read-only company lookup. No real invoice, payment link, charge, receipt or message was created. Merchant onboarding, actual checkout, webhooks, reconciliation, refunds and physical phones remain unverified.

## QuickBooks extension verification

10 new tests cover exact money values, company-bound encrypted credentials, signed webhook bytes, role restrictions, duplicate/uncertain invoice creation, fresh final approval and PostgreSQL permissions. The full 44-test run found one outdated subscription-count expectation; after updating it for two new public tables, the affected monitor and mobile suites passed (8/8). Mobile preview tested at 320, 390, 768 and 1440 pixels. No real QuickBooks financial write was tested.

The dedicated hosted database was inspected after installation. Security advisor results contain only four informational deny-by-default server-table notices. Performance findings are unused indexes in the new empty database. The deployed gateway rejects unauthenticated requests (403). Staff Auth, API exposure, live storage/realtime and actual Intuit OAuth remain to be verified.
