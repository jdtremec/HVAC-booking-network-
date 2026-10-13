# Automatic dispatch engine — development status

Database migration transaction_safe_dispatch_offer_engine applied to Supabase project home-services-dispatch.

## Verified with rolled-back fictional data
- Two qualified HVAC contractor records covering one ZIP and time were matched.
- One offer transitioned to accepted; the other to lost.
- Work order transitions to awaiting_customer.
- This was a sequential test, NOT a real concurrency stress test.

## Production blockers
1. Offer secrets: the database currently stores only a hash of an internally generated token. A delivery design must generate the raw token in a trusted server process, hash it for storage, and send it through a consented delivery channel. Do not expose offer tokens to browsers or the public repository.
2. No SMS messaging service or opted-in contractor recipients connected. No live notifications are sent.
3. No public acceptance API with robust verification, authentication, expiration and abuse protections has been deployed.
4. No background dispatch worker/scheduler handling expiration, expansion, retry or alerts.
5. Provider license, insurance, service-area and availability verification are not populated.
6. Customer provider disclosure and consent flow still incomplete.
7. Race condition tests, including simultaneous acceptances and idempotent retries, are still required.
8. The payment processor and production operating approvals remain pending.

The customer-facing and staff apps should not call privileged database functions using client credentials.
