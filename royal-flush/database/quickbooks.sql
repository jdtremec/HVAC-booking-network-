-- Dedicated Royal Flush database only. Server integration defaults OFF.
begin;
do $$ begin
 if to_regclass('public.work_orders') is not null or to_regclass('public.profiles') is not null then raise exception 'Refusing marketplace database'; end if;
end $$;
alter table royal_flush.settings add column quickbooks_enabled boolean not null default false;
grant usage on schema royal_flush to service_role;
grant select on royal_flush.members,royal_flush.settings,royal_flush.work_orders,royal_flush.invoices to service_role;
-- SELECT FOR UPDATE needs an UPDATE privilege; invoice triggers still prohibit writes without a dispatcher.
grant update(id) on royal_flush.invoices to service_role;

create table royal_flush.qbo_connection (
 id boolean primary key default true check(id),
 status text not null default 'not_connected' check(status in ('not_connected','connected','attention')),
 company_name text, environment text check(environment in ('sandbox','production')),
 connected_at timestamptz, last_sync_at timestamptz, last_error text,
 customers_complete boolean not null default false, items_complete boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into royal_flush.qbo_connection(id) values(true);
create table royal_flush.qbo_customers (
 id text primary key check(id ~ '^[1-9][0-9]{0,29}$'), display_name text not null,
 active boolean not null, email text, phone text, address text, city text, state text, postal_code text,
 provider_updated_at timestamptz, synced_at timestamptz not null default now()
);
create table royal_flush.qbo_items (
 id text primary key check(id ~ '^[1-9][0-9]{0,29}$'), name text not null, description text,
 active boolean not null, type text not null, unit_cents integer check(unit_cents between 0 and 100000000),
 provider_updated_at timestamptz, synced_at timestamptz not null default now()
);
create table royal_flush.qbo_job_invoices (
 id uuid primary key default gen_random_uuid(),
 work_order_id uuid not null unique references royal_flush.work_orders(id),
 draft_id uuid unique references royal_flush.invoices(id),
 customer_id text not null references royal_flush.qbo_customers(id),
 provider_id text unique, number text, total_cents integer check(total_cents between 0 and 100000000),
 balance_cents integer check(balance_cents between 0 and 100000000), currency text not null default 'USD' check(currency='USD'),
 balance_state text check(balance_state in ('zero_balance','partially_settled','open')),
 due_date date, payment_url text, sync_token text, provider_updated_at timestamptz,
 stage text not null default 'preparing' check(stage in ('preparing','awaiting_review','approved','attention')),
 approved_by uuid references royal_flush.members(user_id),approved_at timestamptz,
 approved_total_cents integer, approved_sync_token text, content_hash text, approved_content_hash text,
 synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(payment_url is null or payment_url ~ '^https://connect[.]intuit[.]com/[^[:space:]\\]+$'),
 check(stage<>'approved' or (provider_id is not null and approved_by is not null and approved_at is not null and approved_total_cents is not null))
);
create index qbo_invoice_approver on royal_flush.qbo_job_invoices(approved_by);
create index qbo_invoice_customer on royal_flush.qbo_job_invoices(customer_id);
-- Encrypted tokens, one-use OAuth states, leases and frozen write requests are server-only.
create table royal_flush.qbo_secrets (
 id boolean primary key default true check(id), realm_id text, tokens jsonb,
 lease_id uuid, lease_until timestamptz,
 customer_position integer not null default 1, item_position integer not null default 1,
 invoice_position integer not null default 0, updated_at timestamptz not null default now()
);
insert into royal_flush.qbo_secrets(id) values(true);
create table royal_flush.qbo_oauth_states (
 hash text primary key, actor_id uuid not null references royal_flush.members(user_id), expires_at timestamptz not null
);
create index qbo_oauth_actor on royal_flush.qbo_oauth_states(actor_id);
create table royal_flush.qbo_requests (
 id uuid primary key, job_invoice_id uuid not null unique references royal_flush.qbo_job_invoices(id),
 actor_id uuid not null references royal_flush.members(user_id), payload jsonb not null,
 state text not null check(state in ('reserved','sending','succeeded','uncertain')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index qbo_request_actor on royal_flush.qbo_requests(actor_id);
create table royal_flush.qbo_webhooks (
 hash text primary key, received_at timestamptz not null default now(), processed_at timestamptz
);
do $$ declare t text; begin
 foreach t in array array['qbo_connection','qbo_customers','qbo_items','qbo_job_invoices','qbo_secrets','qbo_oauth_states','qbo_requests','qbo_webhooks'] loop
   execute format('alter table royal_flush.%I enable row level security',t);
   execute format('revoke all on royal_flush.%I from public,anon,authenticated',t);
   execute format('grant all on royal_flush.%I to service_role',t);
 end loop;
 foreach t in array array['qbo_connection','qbo_customers','qbo_items'] loop
   execute format('grant select on royal_flush.%I to authenticated',t);
   execute format('create policy office_read on royal_flush.%I for select to authenticated using ((select rf_private.current_role()) in (''owner'',''dispatcher''))',t);
 end loop;
end $$;
grant select on royal_flush.qbo_job_invoices to authenticated;
create policy assigned_invoice_read on royal_flush.qbo_job_invoices for select to authenticated using(
 (select rf_private.current_role()) in ('owner','dispatcher') or
 (stage='approved' and (select rf_private.current_role())='technician' and exists(
  select 1 from royal_flush.work_orders w where w.id=work_order_id and w.assigned_to=(select auth.uid())
 )));

-- Only trusted server code can claim the single company connection; no exposed definer.
create function royal_flush.qbo_acquire_lease(p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update royal_flush.qbo_secrets set lease_id=p_id,lease_until=now()+interval '120 seconds'
 where id and (lease_until is null or lease_until<now());
 return found;
end $$;
create function royal_flush.qbo_release_lease(p_id uuid) returns void
language sql security invoker set search_path='' as $$
 update royal_flush.qbo_secrets set lease_id=null,lease_until=null where id and lease_id=p_id;
$$;
revoke all on function royal_flush.qbo_acquire_lease(uuid),royal_flush.qbo_release_lease(uuid) from public,anon,authenticated;
grant execute on function royal_flush.qbo_acquire_lease(uuid),royal_flush.qbo_release_lease(uuid) to service_role;

-- Reservation and version validation share a transaction with the draft lock.
create function royal_flush.qbo_reserve_invoice(p_actor uuid,p_draft uuid,p_version integer,p_customer text,p_payload jsonb,p_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare d royal_flush.invoices; job_id uuid;
begin
 if not exists(select 1 from royal_flush.members where user_id=p_actor and active and role='dispatcher') then raise exception 'Dispatcher approval required'; end if;
 if not exists(select 1 from royal_flush.settings where id and quickbooks_enabled and billing_enabled) then raise exception 'QuickBooks billing disabled'; end if;
 select * into d from royal_flush.invoices where id=p_draft for update;
 if d.id is null or d.version<>p_version or d.stage<>'draft' then raise exception 'Draft changed'; end if;
 if exists(select 1 from royal_flush.qbo_job_invoices where work_order_id=d.work_order_id) then raise exception 'Invoice already reserved'; end if;
 insert into royal_flush.qbo_job_invoices(work_order_id,draft_id,customer_id) values(d.work_order_id,d.id,p_customer) returning id into job_id;
 insert into royal_flush.qbo_requests(id,job_invoice_id,actor_id,payload,state) values(p_id,job_id,p_actor,p_payload,'reserved');
 return job_id;
end $$;
revoke all on function royal_flush.qbo_reserve_invoice(uuid,uuid,integer,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function royal_flush.qbo_reserve_invoice(uuid,uuid,integer,text,jsonb,uuid) to service_role;
create function rf_private.freeze_qbo_draft() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from royal_flush.qbo_job_invoices where work_order_id=old.work_order_id) then raise exception 'QuickBooks invoice reserved. Resolve it in QuickBooks before any new invoice.'; end if;
 return new;
end $$;
revoke all on function rf_private.freeze_qbo_draft() from public,anon,authenticated;
create trigger aa_freeze_qbo_draft before update on royal_flush.invoices for each row execute function rf_private.freeze_qbo_draft();
commit;
