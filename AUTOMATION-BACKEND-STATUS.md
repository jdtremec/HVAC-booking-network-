# Automation backend status — October 13, 2026

Implemented in Supabase project home-services-dispatch:

- dispatch_offers: qualified work order offers and two-minute expiration.
- issue_dispatch_token: cryptographically random one-time-style offer secret (hash stored in database).
- respond_dispatch_offer: accepts/declines with database work-order lock. Accepted assignments await customer approval.
- dispatch_outbox: delivery records with **delivery_status disabled**.
- process_dispatch_queue: expires offers, flags unfilled jobs as needs_manual_dispatch, creates offers for new orders and disabled outbox rows.
- dispatch-queue-run Edge Function: JWT required; checks Supabase profile role admin before calling queue processor.
- contractor-offer-response Edge Function: uses an unguessable offer token, checks hash/expiry, no customer PII; real delivery remains disabled.

Verified: SQL dry-run returned processing result with sms_enabled false. Earlier fictional two-contractor sequential test generated one winner; it was rolled back.

Still required before real operations:
1. A scheduled secure invocation of the queue processor (currently no background schedule).
2. Consent-based messaging provider, A2P registration as applicable, phone validation, opt-out processing, monitoring/retries. Do not activate mass SMS without these safeguards.
3. Token issuance and delivery workflow (do not put raw tokens into public repo).
4. Transaction-level concurrency testing under parallel requests, idempotency/retry tests, SMS replay protection.
5. Real customer approval of assigned provider and service terms, plus charge authorization.
6. Real contractor verification, insurance/licensing, correct service coverage and current availability.
7. Security review and operational/legal compliance before production.
8. Customer phone/address should not be put in the public GitHub Pages testing interface.

No marketing SMS is being sent, and none of these functions is a customer-ready service yet.
