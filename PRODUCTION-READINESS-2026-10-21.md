# Production readiness check — October 21, 2026

## Confirmed implemented
- On each `provider_applications` INSERT, a database trigger moves new applications to `under_review`; a second trigger adds a private `application_review_events` entry and a private `notification_events` entry with delivery_state `disabled`. This is automated triage only and **does not verify or approve** licenses/insurance.
- SQL transaction test submitted a fictional provider and observed `triaged=1`, `queued_disabled=1`; transaction was rolled back.
- `mark_new_applications_for_review()` service-role-only database function exists for existing new applications. The immediate trigger handles future submissions.
- Terms, privacy and cancellation *draft* pages exist for legal review. Do not represent these as final legally approved documents.

## No live notification delivery
- `notification_events` stores events, not SMS/email dispatch. No SMS or email provider is wired into it. Provider customer opt-in, A2P/carrier compliance and STOP processing remain unimplemented.

## Cross-device test procedure (not executed)
1. iPhone Safari and Android Chrome: load customer homepage, fictional request and recover from failed network.
2. Windows Chrome and iPad Safari: sign in as dispatcher; ensure test application visible and can be marked under review.
3. Two devices: generate customer approval link from approved **fictional** provider, confirm once, verify second acceptance rejected and wrong-provider link rejected.
4. Validate password protection, RLS access for non-staff, message cancellation, nonlogged tokens, short expiration, no PII in URLs.
5. Validate error handling, accessibility, mobile layouts, load times and GitHub Pages publication.
6. Use provider-approved legal terms, payment flow, refund paths, reconciliation, fraud and chargeback tests before processing any real charge.

## Blocked launch requirements
- 0 verified active contractors; business insurance/licensing and provider credentials need human confirmation and legal counsel.
- No real customer intake, SMS delivery, verified contact consent or real payment processing.
- Customer terms and privacy/cancellation wording are drafts, not approved policies.
- Security advisory warns about authenticated SECURITY DEFINER functions and leaked-password protection. Review function bodies and RLS dependencies before revoking helper grants.
- Live device testing cannot be attested without opening pages and exercising authentication across actual devices.
