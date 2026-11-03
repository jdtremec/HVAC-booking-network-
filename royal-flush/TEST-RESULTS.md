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
- Optional Realtime publication setup verified against embedded PostgreSQL: fails if the publication is absent; adds only four company tables; succeeds on repeat without duplicate additions.

## Limits

- Edge failed to launch in the Windows execution environment; Chrome completed the test.
- Viewports are not physical iPhone Safari/Android tests.
- No dedicated live project, actual Auth sign-in, Supabase REST integration or cross-device WebSocket delivery tested. Monitor connection tests use an injected fake transport; actual latency is unverified.
- PGlite does not test simultaneous database sessions. Hosted concurrency and API permission checks remain required.
- No SMS/email, payments, invoicing, real customer onboarding, emergency response or legal approval tested/activated.
- Marketplace audited, not repaired or fully revalidated.

Reproduce with npm ci, npm run build, npm test and installed Chrome. The browser test owns port 4173 and stops its server afterward.


Owner-monitoring combined run: 22 tests passed, zero failures. After adding publication and owner-revocation coverage, the targeted database run passed all 11 checks (10 overlap with the combined run). No application code changed after the combined run.
