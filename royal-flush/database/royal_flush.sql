-- Royal Flush only. Apply to a NEW dedicated Supabase project, never the marketplace.
begin;
do $$ begin
  if to_regclass('public.work_orders') is not null or to_regclass('public.profiles') is not null then
    raise exception 'Refusing marketplace database: use a dedicated Royal Flush Supabase project.';
  end if;
end $$;
create schema royal_flush;
create schema rf_private;
revoke all on schema royal_flush, rf_private from public, anon, authenticated;
grant usage on schema royal_flush, rf_private to authenticated;

create table royal_flush.settings (
  id boolean primary key default true check(id),
  company_slug text not null default 'royal-flush-florida' check(company_slug='royal-flush-florida'),
  intake_enabled boolean not null default false,
  business_confirmed boolean not null default false,
  legal_reviewed boolean not null default false,
  security_reviewed boolean not null default false,
  after_hours_routing_verified boolean not null default false,
  approved_at timestamptz,
  terms_version text not null default 'rf-draft-2026-11-03',
  check (not intake_enabled or (business_confirmed and legal_reviewed and security_reviewed and after_hours_routing_verified and approved_at is not null))
);
insert into royal_flush.settings(id) values(true);
create table royal_flush.members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check(length(trim(display_name)) between 1 and 100),
  role text not null check(role in ('owner','dispatcher','technician','customer')),
  active boolean not null default true
);
create table royal_flush.work_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references royal_flush.members(user_id),
  created_by uuid not null default auth.uid() references royal_flush.members(user_id),
  customer_name text not null check(length(trim(customer_name)) between 1 and 100),
  customer_phone text not null check(customer_phone ~ '^[0-9+() .-]{7,30}$'),
  street_address text not null check(length(trim(street_address)) between 1 and 200),
  city text not null check(length(trim(city)) between 1 and 100),
  state text not null default 'FL' check(state='FL'),
  zip_code text not null check(zip_code ~ '^[0-9]{5}$'),
  issue text not null check(issue in ('Leak or burst pipe','Clogged drain','Water heater','Fixture repair','Other plumbing')),
  notes text not null default '' check(length(notes)<=1000),
  priority text not null default 'normal' check(priority in ('normal','urgent')),
  terms_version text not null,
  assigned_to uuid references royal_flush.members(user_id),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  status text not null default 'requested' check(status in ('requested','assigned','en_route','working','completed','cancelled')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((assigned_to is null and scheduled_start is null and scheduled_end is null) or
         (assigned_to is not null and scheduled_start is not null and scheduled_end>scheduled_start)),
  check(status in ('requested','cancelled') or assigned_to is not null),
  check(status<>'requested' or assigned_to is null)
);
create index work_orders_customer on royal_flush.work_orders(customer_id);
create index work_orders_creator on royal_flush.work_orders(created_by);
create index work_orders_assignee_window on royal_flush.work_orders(assigned_to,scheduled_start,scheduled_end);
create index work_orders_queue on royal_flush.work_orders(status,created_at desc);
create table royal_flush.work_order_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references royal_flush.work_orders(id),
  actor_id uuid not null references royal_flush.members(user_id),
  event_type text not null,
  status text not null,
  created_at timestamptz not null default now()
);
create index work_order_events_order on royal_flush.work_order_events(work_order_id,created_at desc);
create index work_order_events_actor on royal_flush.work_order_events(actor_id);
create table royal_flush.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references royal_flush.work_order_events(id),
  work_order_id uuid not null references royal_flush.work_orders(id),
  event_type text not null,
  delivery_state text not null default 'disabled' check(delivery_state='disabled'),
  created_at timestamptz not null default now()
);
create index notification_outbox_order on royal_flush.notification_outbox(work_order_id);

-- Private, fixed-search-path membership lookup. No JWT/user_metadata authorization.
create function rf_private.current_role() returns text
language sql stable security definer set search_path='' as $$
  select role from royal_flush.members where user_id=auth.uid() and auth.uid() is not null and active;
$$;
revoke all on function rf_private.current_role() from public, anon;
grant execute on function rf_private.current_role() to authenticated;

alter table royal_flush.settings enable row level security;
alter table royal_flush.members enable row level security;
alter table royal_flush.work_orders enable row level security;
alter table royal_flush.work_order_events enable row level security;
alter table royal_flush.notification_outbox enable row level security;
create policy settings_member_read on royal_flush.settings for select to authenticated
  using((select rf_private.current_role()) is not null);
create policy members_read on royal_flush.members for select to authenticated
  using((select rf_private.current_role()) in ('owner','dispatcher') or (user_id=(select auth.uid()) and active));
create policy orders_read on royal_flush.work_orders for select to authenticated
  using((select rf_private.current_role()) in ('owner','dispatcher')
    or ((select rf_private.current_role())='technician' and assigned_to=(select auth.uid()))
    or ((select rf_private.current_role())='customer' and customer_id=(select auth.uid())));
create policy orders_insert on royal_flush.work_orders for insert to authenticated
  with check(created_by=(select auth.uid()) and
    ((select rf_private.current_role()) = 'dispatcher'
    or ((select rf_private.current_role())='customer' and customer_id=(select auth.uid()))));
create policy orders_update on royal_flush.work_orders for update to authenticated
  using((select rf_private.current_role()) = 'dispatcher'
    or ((select rf_private.current_role())='technician' and assigned_to=(select auth.uid())))
  with check((select rf_private.current_role()) = 'dispatcher'
    or ((select rf_private.current_role())='technician' and assigned_to=(select auth.uid())));
create policy events_read on royal_flush.work_order_events for select to authenticated
  using(exists(select 1 from royal_flush.work_orders w where w.id=work_order_id));
create policy outbox_office_read on royal_flush.notification_outbox for select to authenticated
  using((select rf_private.current_role()) in ('owner','dispatcher'));

revoke all on all tables in schema royal_flush from public, anon, authenticated;
grant select on all tables in schema royal_flush to authenticated;
grant insert(id,customer_id,customer_name,customer_phone,street_address,city,zip_code,issue,notes,priority,terms_version)
  on royal_flush.work_orders to authenticated;
grant update(assigned_to,scheduled_start,scheduled_end,status) on royal_flush.work_orders to authenticated;

-- Runs as caller: RLS and column privileges still apply. Enforces workflow even on direct REST writes.
create function rf_private.guard_order() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r text := rf_private.current_role(); enabled boolean; approved_version text;
begin
  if auth.uid() is null or r is null then raise exception 'Royal Flush membership required'; end if;
  if r='owner' then raise exception 'Owner monitoring is read-only'; end if;
  if tg_op='INSERT' then
    select intake_enabled,terms_version into enabled,approved_version from royal_flush.settings where id;
    if not coalesce(enabled,false) then raise exception 'Real customer intake is disabled pending launch review'; end if;
    if new.terms_version is distinct from approved_version then raise exception 'Service notice version is not current'; end if;
    if new.created_by<>auth.uid() or new.status<>'requested' or new.assigned_to is not null or new.version<>1 then
      raise exception 'Requests must start unassigned'; end if;
    if r not in ('dispatcher','customer') then raise exception 'This role cannot create requests'; end if;
    if r='customer' and new.customer_id is distinct from auth.uid() then raise exception 'Customer identity mismatch'; end if;
    if new.customer_id is not null and not exists(select 1 from royal_flush.members where user_id=new.customer_id and role='customer' and active) then
      raise exception 'Customer must have active company access'; end if;
  else
    if (to_jsonb(new)-array['assigned_to','scheduled_start','scheduled_end','status'])
      is distinct from (to_jsonb(old)-array['assigned_to','scheduled_start','scheduled_end','status']) then
      raise exception 'Protected work order fields cannot change'; end if;
    if r='technician' and (old.assigned_to<>auth.uid() or
      (new.assigned_to,new.scheduled_start,new.scheduled_end) is distinct from (old.assigned_to,old.scheduled_start,old.scheduled_end)
      or new.status not in ('en_route','working','completed')) then raise exception 'Technicians can only progress their own assigned jobs'; end if;
    if new.status<>old.status and not (
      (old.status='requested' and new.status in ('assigned','cancelled')) or
      (old.status='assigned' and new.status in ('en_route','cancelled')) or
      (old.status='en_route' and new.status in ('working','cancelled')) or
      (old.status='working' and new.status in ('completed','cancelled'))
    ) then raise exception 'Invalid service status transition'; end if;
    if (new.assigned_to,new.scheduled_start,new.scheduled_end) is distinct from (old.assigned_to,old.scheduled_start,old.scheduled_end)
      and (r<>'dispatcher' or old.status not in ('requested','assigned') or new.status<>'assigned') then
      raise exception 'Only office staff may schedule a job before work starts'; end if;
    if new is not distinct from old then return null; end if;
    new.version:=old.version+1; new.updated_at:=now();
  end if;
  if new.assigned_to is not null and new.status in ('assigned','en_route','working') then
    if not exists(select 1 from royal_flush.members where user_id=new.assigned_to and role='technician' and active) then
      raise exception 'Assignment requires an active Royal Flush technician'; end if;
    -- PostgREST uses READ COMMITTED. Serialize schedules per technician.
    if current_setting('transaction_isolation')<>'read committed' then raise exception 'Scheduling requires read committed isolation'; end if;
    perform pg_advisory_xact_lock(hashtextextended(new.assigned_to::text,0));
    if exists(select 1 from royal_flush.work_orders w where w.id<>new.id and w.assigned_to=new.assigned_to
      and w.status in ('assigned','en_route','working')
      and w.scheduled_start<new.scheduled_end and w.scheduled_end>new.scheduled_start) then
      raise exception 'Technician already has an overlapping appointment'; end if;
  end if;
  return new;
end $$;
revoke all on function rf_private.guard_order() from public,anon,authenticated;
create trigger guard_order before insert or update on royal_flush.work_orders for each row execute function rf_private.guard_order();

-- Append-only audit + disabled notification outbox, atomically in the work-order transaction.
-- Definer is needed because clients cannot insert into these two tables.
create function rf_private.record_order_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare eid uuid; kind text;
begin
  if auth.uid() is null or rf_private.current_role() is null then raise exception 'Authenticated company actor required'; end if;
  kind:=case when tg_op='INSERT' then 'requested'
    when (new.assigned_to,new.scheduled_start,new.scheduled_end) is distinct from (old.assigned_to,old.scheduled_start,old.scheduled_end) then 'scheduled'
    else new.status end;
  insert into royal_flush.work_order_events(work_order_id,actor_id,event_type,status)
    values(new.id,auth.uid(),kind,new.status) returning id into eid;
  insert into royal_flush.notification_outbox(event_id,work_order_id,event_type)
    values(eid,new.id,kind);
  return new;
end $$;
revoke all on function rf_private.record_order_event() from public,anon,authenticated;
create trigger record_order_event after insert or update on royal_flush.work_orders for each row execute function rf_private.record_order_event();
-- No self-enrollment, member changes, deletes, event edits, notification delivery or payment privileges.
commit;

