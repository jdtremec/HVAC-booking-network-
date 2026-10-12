# Production dispatch blueprint — HVAC + Plumbing

The public index.html is a **local-device demonstration only**, not a secure booking system. Never enter real customer personal data there. Do not put API secrets in GitHub Pages.

## Live stack (proposed)
- Customer and contractor web UI: existing static site, reworked to call authenticated backend endpoints.
- Postgres database + authentication + row-level access restrictions (e.g. Supabase).
- Server functions for job creation, eligibility, time-limited dispatch offers, acceptance, customer confirmation, cancellation and audit logging.
- SMS vendor (e.g. Twilio Messaging Service), with compliant sender registration and contractor opt-in/STOP/HELP handling.
- Stripe Connect or equivalent for payments only after merchant-of-record and provider terms have been reviewed.

## Schema minimum
providers(id,trade,status,license_verification_status,service_area,phone_verified,sms_opt_in_at,timezone)
provider_slots(id,provider_id,start_at,end_at,status)
provider_rate_schedules(id,provider_id,service_type,minimum_fee,diagnostic_fee,callout_fee,hourly_rate,currency)
jobs(id,customer_id,trade,address_id,requested_start_at,status,created_at,offer_deadline,assigned_provider_id)
job_offers(id,job_id,provider_id,status,sent_at,responded_at,expires_at) UNIQUE(job_id,provider_id)
job_events(id,job_id,actor_id,event_type,reason,created_at)
payment_records(id,job_id,connected_account_id,processor_payment_id,status)
consents(id,subject_id,type,channel,consent_text_version,timestamp,revoked_at)

## Transaction-safe dispatch sequence
1. A customer selects trade, problem, service address, and a candidate appointment time. Validate and geocode location server-side.
2. Verify eligible providers: trade qualifications, license/insurance status, actual service coverage, working hours, published slot, opt-in, and suspension status.
3. Create job and eligible offers in a database transaction. Do not reveal contractor personal phone numbers to the customer.
4. Queue a short SMS to each opted-in eligible provider; send only an approximate job location plus secure, expiring accept/decline link, not full customer PII.
5. On acceptance, server checks offer validity and obtains a row lock / compare-and-swap on job status and slot occupancy. Exactly one provider wins; all others receive a no-longer-available state. Provider is not booked finally until customer confirms identity, price, and provider service terms.
6. After two minutes with no claim, server records escalation and tries additional eligible providers or asks customer to choose another slot. Avoid unlimited rebroadcast loops or excessive alerts.
7. Record contractor cancellation reason, late cancellations, job completion and validated customer complaint. Permit disputes before penalties.
8. Payments through the approved processor; no card numbers or payout secrets in front-end storage.

## Safety / regulatory gates
- Explicit contractor opt-in for job texts and opt-out support; observe U.S. messaging registration and carrier rules.
- Separate customer consent and identity verification for service updates.
- Do not send live work orders until individual authenticated access, authorization policies, abuse protection and server-side locking are tested.
- Identify the licensed service provider and applicable terms before binding customer service authorization.
- Review state trade licensing, marketplace contracts, insurance, compensation and payment flow before launch.
- Audit appointment change, cancellation, refund, claim and payout operations.
