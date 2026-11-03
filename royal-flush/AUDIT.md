# Existing project audit — November 3, 2026

Repository main: 379aa63b029be39981cff2a7aa375ad4ee262415. Supabase: home-services-dispatch, stsmdfxcekkxpngkfrmz.

## Verified

- Standalone HTML prototypes and one initial supabase/schema.sql; no existing package/test runner.
- Customer index is a Mississippi demo posting to the old demo-intake Edge Function.
- dispatch.html has a broken concatenated script and trailing duplicated markup/script text, plus an unpinned Supabase CDN major version.
- The database was initially inactive. Restore succeeded; it subsequently reported ACTIVE_HEALTHY.
- Live metadata lists 24 public tables with RLS and 23 migrations. The checked-in baseline does not capture the live schema.
- Work-order policies grant shared marketplace staff access, or customer/contractor access. This is not company isolation.
- field_crews and notification_events use the same marketplace staff helper.
- Security advisors flag five authenticated-executable SECURITY DEFINER functions, disabled leaked-password protection, and two RLS/no-policy informational findings on rate-limit tables. An empty report while inactive was not treated as clearance.
- No customer row data was needed. Estimated row counts are not proof of an empty database.

## Royal Flush approach

The self-contained royal-flush/ package reuses the intake/work-order/dispatch/role workflow while replacing the shared permission boundary. New objects belong to a dedicated database and royal_flush schema. rf_private contains fixed-search-path helpers/triggers and must not be exposed.

The bootstrap and live builder reject the marketplace. No existing marketplace schema, functions, data or HTML were edited; restoring the existing project was the only infrastructure state change.

Members require trusted provisioning. Clients cannot edit roles, launch controls, customer ownership, event history or delivery. Technicians progress their own jobs only. Sessions stay in memory; no self-signup.

## Remaining verification

No live Royal Flush project was created or modified. Embedded PostgreSQL tests simulate Auth claims; actual Supabase REST/Auth, advisors, parallel-session scheduling and physical-device checks remain required.

References:
- [Privileged-function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database functions](https://supabase.com/docs/guides/database/functions)
- [November 10 TLS cipher change](https://supabase.com/changelog/cbc-tls-ciphers-deprecated): current browsers use modern TLS; old clients need testing.

