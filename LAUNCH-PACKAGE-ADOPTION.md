# Launch Package Adoption Register — October 13, 2026

Source: User-supplied *Home Services Network: Launch Package* (13 pages). The document describes proposed changes on branch `launch-readiness-oct-2026` plus ZIP/patch files, but the connected GitHub repository has no matching branch. Source files from that claimed branch were not attached. Do not claim the proposed migrations/pages have been merged.

## Implemented in this review
- Supabase `provider_applications` table, restricted to dispatch staff for viewing/review. Not publicly writable.
- Supabase `contractor_verification` table, restricted to dispatch staff. License and insurance checks must be verified by humans; flags are not evidence by themselves.

## Adopt next (after code review and staged testing)
- Simple provider application endpoint with abuse prevention, text consent (optional, separately recorded), and staff review.
- One-time customer approval links showing identified provider, rates, terms and authorization. Existing `customer_confirmations` and `confirm_dispatch_order` must be reconciled first.
- Dispatcher exceptions-first dashboard with visible errors, job prioritization, 60-second fallback refresh and audit events.
- Secure deployment checks for HTML script syntax, accidental embedded secrets, and link validation.
- Privacy, cancellation, partner and customer terms drafts; do not publish as finalized legal terms until professional review.
- Contractor eligibility blocking when required credentials expire. Supabase currently stores separate status and verification flags and does not automatically re-verify legal status.
- Read-only database audit and source-controlled migrations and Edge Functions.
- Optional completed-job pilot fees, subject to provider contract/legal review.

## Do NOT automatically implement as written
- Replace all payment arrangements with the document's Option A as a final commercial decision. Treat it as a pilot recommendation.
- Assume carrier-registration costs/timelines are fixed; reconfirm before purchase.
- Assume any cited Mississippi license threshold definitively resolves platform licensing; counsel must review scope.
- Call the public booking site `ServiceNow`; adopt a unique name only after clearance.
- Turn on real messaging or process real customer information.
- Overwrite existing live database migrations using an unknown patch or unreviewed branch.

## Current production blockers
- No verified participating contractor in `contractors`.
- Customer intake is demo-only; first real customer intake and consent not live.
- No production SMS sending, payment acceptance, one-time customer confirmation UX or scheduled queue worker.
- GPS priority ranking exists in the DB but is not integrated with outgoing offer generation.
- Authentication, permissions, concurrency and published Pages deployment require end-to-end production validation.
