# Royal Flush service department

Company-only adaptation of the Home Services Dispatch workflow for **Royal Flush Plumbing of the Florida Panhandle, Inc.**

**Development preview, not cleared for real customer use.** No real requests, messages, charges or invitations are sent by the default build. Sample contacts are read-only, records live only in browser memory, and reloading resets the preview.

## Run

Use Node 22+ and npm. From this directory:

~~~sh
npm ci
npm run build
npm run dev
~~~

Open the printed local URL. Preview mode requires no credentials. Select dispatcher, technician or customer in the preview role selector.

~~~sh
npm test
~~~

Database tests use embedded PostgreSQL through PGlite, with simulated Supabase Auth roles and claims. Browser tests default to installed Google Chrome; set RF_BROWSER_CHANNEL=msedge to use Edge where supported. Tests use port 4173, so stop the preview server first.

## Included

- Plumbing intake, work orders, office dispatch and technician progress.
- Requested → Assigned → En route → Working → Completed, plus office cancellation.
- Central Time appointment windows, daylight-saving validation and overlap rejection.
- Dedicated company memberships: owner, dispatcher, technician, invited customer.
- Separate Supabase project requirement, company schema, RLS and restricted column grants.
- Append-only work-order events and a notification outbox constrained to disabled.
- Search, status filters, service history and responsive views.
- Locked-by-default real intake, safe configuration checks and deployment instructions.

The original marketplace remains unchanged. The same concepts and fields are reused; marketplace contractor broadcasting, applications, provider approval links and global staff permissions are excluded.

## Deploy

Follow [DEPLOYMENT.md](DEPLOYMENT.md). The static preview is in dist/ after building. Host that directory only on a **separate origin**. Never publish this source directory or the marketplace root as the Royal Flush deployment.

See [AUDIT.md](AUDIT.md), [LAUNCH-REVIEW.md](LAUNCH-REVIEW.md) and [TEST-RESULTS.md](TEST-RESULTS.md) for evidence and remaining checks.

