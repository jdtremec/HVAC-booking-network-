# Royal Flush deployment

## Private preview

1. Run npm ci and npm run build with RF_MODE unset (or preview).
2. Publish **only royal-flush/dist/** to a separate, private static site. The bundle contains fictional records and no backend credentials.
3. Verify the development-preview banner, sample request → assignment → technician progression, and reload reset.
4. Keep the original GitHub Pages marketplace workflow and root untouched.

The Sites manifest in .openai/hosting.json identifies the owner-private preview created in this chat. Reuse that identity for later publication. A preview URL does not mean the operational system is production-ready.

## Dedicated Supabase deployment, after review

**Do not run the Royal Flush schema on home-services-dispatch (stsmdfxcekkxpngkfrmz).** The bootstrap refuses databases containing the marketplace's public.work_orders or public.profiles. Use a new, separately controlled Supabase project so Auth users, customer records, storage, logs and keys are independent.

1. Complete LAUNCH-REVIEW.md with the company owner and Florida counsel. Confirm retention, privacy contact, service/cancellation/fee terms, approved notice version and operational procedures. Replace all draft information-page language before accepting customers.
2. Create the dedicated project. Disable public signups and anonymous sign-ins. Configure password protections, strong passwords and approved site URLs. Plan MFA enrollment and app challenge handling before requiring MFA; this version only implements password sign-in.
3. In that project's SQL editor, execute database/royal_flush.sql once. This is a transactional bootstrap, not an applied migration or a dump of the old database. Keep it under version control; use the Supabase CLI to create subsequent migrations.
4. In Data API configuration, expose royal_flush. **Never expose rf_private**. Review other exposed schemas and default grants. No anon privileges are granted by the bootstrap.
5. Create approved staff users through trusted Supabase administration. Do not send invitations until authorized. Use the owner-confirmed separate email addresses from private setup notes. Add memberships with actual Auth UUIDs:

~~~sql
-- Replace placeholders with verified auth.users IDs through trusted administration.
insert into royal_flush.members(user_id, display_name, role)
values
  ('OWNER_AUTH_UUID', 'Company owner', 'owner'),
  ('DISPATCHER_AUTH_UUID', 'Company dispatcher', 'dispatcher');
-- Add each approved technician separately with role='technician'.
~~~

**Owner access is read-only. Debra’s dispatcher role controls intake, assignments, scheduling and office status changes. The owner has no dispatch approval step and cannot create, assign, cancel or progress jobs, including through direct API calls.**

No self-promotion or member editing is available through the web client. Only active company technicians receive jobs. Customers are invitation-only in this initial version; anonymous public intake is absent. Office staff may create a work order without a customer login. Technicians see assigned jobs; office staff see company records.

6. Run database/enable_realtime.sql in the same dedicated project to add the four company tables to supabase_realtime. This file is opt-in and idempotent. Existing RLS and authenticated grants continue to apply; do not grant anonymous reads. The client subscribes only to INSERT/UPDATE and rereads authorized data.
7. Set build variables RF_MODE=live, RF_SUPABASE_URL to the dedicated HTTPS project URL, and RF_SUPABASE_PUBLISHABLE_KEY to its sb_publishable_ key. Environment files are not loaded automatically. Never use a service-role or secret key in the frontend. The builder and adapter reject the old project and legacy/secret keys.
8. Run npm run build; publish dist/ on the separate company origin with HTTPS. Use _headers where supported; otherwise configure equivalent CSP, nosniff, no-referrer, frame restrictions and no-store headers at the host. Never share an origin with marketplace code/service workers.
9. With fictional records, verify Auth, expiry, sign-out, RLS through the actual REST API, customer/technician isolation, events, offline recovery and two simultaneous dispatcher updates. Stress-test concurrent scheduling in separate database sessions. Run Supabase advisors and review expected private helpers.
10. Implement and test after-hours delivery to the Royal Flush service cell and approved owner alert destination. The current version provides a call link and disabled outbox only. Its additional after-hours verification gate must remain false until routing actually works. Only after all reviews and routing verification may a trusted administrator enable intake:

~~~sql
update royal_flush.settings
set business_confirmed=true,
    legal_reviewed=true,
    security_reviewed=true,
    after_hours_routing_verified=true,
    approved_at=now(),
    intake_enabled=true
where id=true;
~~~

These attestations are **not a substitute for review**. The web application cannot change them. Until then, backend inserts fail even if someone bypasses the UI.

## Operations and rollback

- Stop intake: update royal_flush.settings set intake_enabled=false where id=true.
- Remove company access: set the member's active=false, revoke Auth sessions and review assignments. Membership is checked in the database, not editable JWT metadata.
- Unpublish or restore the previous static version if needed. Do not drop the schema/reset the database as rollback. Maintain backups and test restoration.
- UI updates include row version to detect stale screens. Scheduling uses a transaction-level lock per technician under READ COMMITTED. Parallel-session testing remains required.
- Jobs are fetched in pages of 500 so older active jobs are included. Activity is limited to the latest 200 events; the owner overview shows 20 of these. Notification history is the latest 50 events. Add server-side summaries/archive retrieval before higher volume; the dashboard does not promise unlimited audit-history browsing.
- Customer identity/address is not editable after creation. Design an audited correction workflow before production.
- Realtime subscription and a 15-second polling fallback are implemented for the owner while signed in. Visibility/focus/reconnection refresh the data; sleeping or closed mobile browsers do not provide continuous monitoring. No always-on phone alerts, recurring dispatcher, delivery provider, routing optimizer, payments, QuickBooks sync or automated emergency response is installed.
- Outbox records contain event IDs, not recipient details. Future delivery needs consent, verified contacts, retries/idempotency, receipts, suppression/opt-out handling and monitoring.
- Completion is a status only; it does not invoice, collect money or contact a customer.


## Remote owner acceptance check

Use separate browser profiles/devices for dispatcher, owner and technician in the dedicated staging project. Create only fictional records with launch gates controlled by a trusted administrator. Confirm the owner sees a new request, assignment, each technician status and cancellation without refreshing manually. Confirm owner API inserts and updates fail, while the dispatcher retains control. Disable the change feed and verify backup reads; disconnect/reconnect the owner, sleep/wake the phone, sign out during a read, expire the session and deactivate the owner membership. Ensure the screen marks stale data and clears data when access ends. Record latency and review Supabase advisors before activation.

Real-time activity means changes entered by staff. It does not include GPS tracking, call recording, payments or customer messages. Keep this dashboard open on the owner’s computer or phone; unattended alerts while closed require a separately deployed notification worker and approved messaging service. Private owner contact details belong in server-side configuration, never the frontend bundle.

Implementation reference: [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
