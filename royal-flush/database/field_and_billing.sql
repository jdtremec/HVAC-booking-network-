-- Unapplied extension bootstrap: run AFTER royal_flush.sql in the dedicated project.
begin;
do $$ begin
  if to_regclass('public.work_orders') is not null or to_regclass('public.profiles') is not null then
    raise exception 'Refusing marketplace database';
  end if;
end $$;
alter table royal_flush.settings
  add column photos_enabled boolean not null default false,
  add column billing_enabled boolean not null default false,
  add column billing_reviewed boolean not null default false,
  add column payments_enabled boolean not null default false,
  add column payment_provider_verified boolean not null default false,
  add check(not photos_enabled or (business_confirmed and legal_reviewed and security_reviewed)),
  add check(not billing_enabled or (business_confirmed and legal_reviewed and security_reviewed and billing_reviewed)),
  add check(not payments_enabled or (billing_enabled and payment_provider_verified));

create function rf_private.can_read_internal_job(job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select rf_private.current_role() in ('owner','dispatcher','technician') and exists(
   select 1 from royal_flush.work_orders where id=job_id);
$$;
create function rf_private.can_post_job(job_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from royal_flush.work_orders where id=job_id and
   (rf_private.current_role()='dispatcher' or (rf_private.current_role()='technician'
    and assigned_to=auth.uid() and status in ('assigned','en_route','working','completed'))));
$$;
revoke all on function rf_private.can_read_internal_job(uuid),rf_private.can_post_job(uuid) from public,anon;
grant execute on function rf_private.can_read_internal_job(uuid),rf_private.can_post_job(uuid) to authenticated;

create table royal_flush.job_updates (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references royal_flush.work_orders(id),
  author_id uuid not null default auth.uid() references royal_flush.members(user_id),
  author_name text not null,
  kind text not null check(kind in ('progress','before','after','needs_office')),
  body text not null check(length(trim(body)) between 1 and 2000),
  photo_path text unique,
  photo_bytes integer,
  created_at timestamptz not null default now(),
  check((photo_path is null and photo_bytes is null) or
    (photo_path is not null and photo_bytes is not null and photo_path=work_order_id::text||'/'||author_id::text||'/'||id::text||'.jpg'
      and photo_bytes between 1 and 5242880))
);
create index job_updates_order_time on royal_flush.job_updates(work_order_id,created_at desc);
create index job_updates_author on royal_flush.job_updates(author_id);
alter table royal_flush.job_updates enable row level security;
create policy updates_read on royal_flush.job_updates for select to authenticated
 using(rf_private.can_read_internal_job(work_order_id));
create policy updates_insert on royal_flush.job_updates for insert to authenticated
 with check(author_id=(select auth.uid()) and rf_private.can_post_job(work_order_id));
revoke all on royal_flush.job_updates from public,anon,authenticated;
grant select on royal_flush.job_updates to authenticated;
grant insert(id,work_order_id,kind,body,photo_path,photo_bytes) on royal_flush.job_updates to authenticated;
create function rf_private.guard_job_update() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(rf_private.can_post_job(new.work_order_id),false) then raise exception 'Only the dispatcher or assigned technician can post updates'; end if;
 if new.author_id is distinct from auth.uid() then raise exception 'Update author mismatch'; end if;
 if new.photo_path is not null and not (select photos_enabled from royal_flush.settings where id) then raise exception 'Photo uploads are disabled pending review'; end if;
 select display_name into new.author_name from royal_flush.members where user_id=auth.uid() and active;
 new.body:=trim(new.body);return new;
end $$;
revoke all on function rf_private.guard_job_update() from public,anon,authenticated;
create trigger guard_job_update before insert on royal_flush.job_updates for each row execute function rf_private.guard_job_update();

create function rf_private.invoice_subtotal(items jsonb) returns integer
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; total bigint:=0; quantity bigint; price bigint;
begin
 if octet_length(items::text)>20000 then raise exception 'Invoice payload is too large'; end if;
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 20 then raise exception 'Invoice needs 1-20 items'; end if;
 for item in select value from jsonb_array_elements(items) loop
   if jsonb_typeof(item->'description') is distinct from 'string' or length(trim(item->>'description')) not between 1 and 200
      or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'unit_cents') is distinct from 'number'
      or coalesce(item->>'quantity','') !~ '^[0-9]{1,4}$' or coalesce(item->>'unit_cents','') !~ '^[0-9]{1,8}$'
   then raise exception 'Invalid invoice item'; end if;
   quantity:=(item->>'quantity')::bigint;price:=(item->>'unit_cents')::bigint;
   if quantity not between 1 and 1000 or price not between 1 and 10000000 then raise exception 'Invalid invoice quantity or price'; end if;
   total:=total+quantity*price;
 end loop;
 if total>100000000 then raise exception 'Invoice exceeds supported amount'; end if;
 return total::integer;
end $$;
revoke all on function rf_private.invoice_subtotal(jsonb) from public,anon;
grant execute on function rf_private.invoice_subtotal(jsonb) to authenticated;
create table royal_flush.invoices (
 id uuid primary key default gen_random_uuid(),
 work_order_id uuid not null unique references royal_flush.work_orders(id),
 created_by uuid not null default auth.uid() references royal_flush.members(user_id),
 line_items jsonb not null,
 subtotal_cents integer not null,
 currency text not null default 'USD' check(currency='USD'),
 stage text not null default 'draft' check(stage in ('draft','linked')),
 provider_invoice_number text,
 provider_url text,
 provider_total_cents integer,
 provider_checked_at timestamptz,
 payment_status text not null default 'not_synced' check(payment_status='not_synced'),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((stage='draft' and provider_invoice_number is null and provider_url is null and provider_total_cents is null and provider_checked_at is null)
  or (stage='linked' and provider_invoice_number is not null and provider_total_cents is not null and length(trim(provider_invoice_number)) between 1 and 80 and provider_url is not null
     and provider_total_cents between 1 and 100000000 and provider_checked_at is not null))
);
create index invoices_creator on royal_flush.invoices(created_by);
alter table royal_flush.invoices enable row level security;
create policy invoices_read on royal_flush.invoices for select to authenticated
 using((select rf_private.current_role()) in ('owner','dispatcher') or
   (stage='linked' and exists(select 1 from royal_flush.work_orders where id=work_order_id)));
create policy invoices_insert on royal_flush.invoices for insert to authenticated
 with check((select rf_private.current_role())='dispatcher' and created_by=(select auth.uid()));
create policy invoices_update on royal_flush.invoices for update to authenticated
 using((select rf_private.current_role())='dispatcher') with check((select rf_private.current_role())='dispatcher');
revoke all on royal_flush.invoices from public,anon,authenticated;
grant select on royal_flush.invoices to authenticated;
grant insert(id,work_order_id,line_items) on royal_flush.invoices to authenticated;
grant update(line_items,provider_invoice_number,provider_url,provider_total_cents) on royal_flush.invoices to authenticated;
create function rf_private.guard_invoice() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if rf_private.current_role() is distinct from 'dispatcher' then raise exception 'Dispatcher approval required'; end if;
 if not (select billing_enabled from royal_flush.settings where id) then raise exception 'Billing is disabled pending review'; end if;
 if tg_op='UPDATE' then
   if old.stage='linked' then raise exception 'Linked invoices are managed in QuickBooks; do not change the local draft'; end if;
   new.version:=old.version+1;
 end if;
 new.subtotal_cents:=rf_private.invoice_subtotal(new.line_items);
 if new.provider_url is not null then
   if not (select payments_enabled from royal_flush.settings where id) then raise exception 'Payment handoff is disabled pending processor verification'; end if;
   if length(new.provider_url)>2000 or new.provider_url !~ '^https://connect[.]intuit[.]com/[^[:space:]\\]+$' then raise exception 'Use a customer-facing QuickBooks HTTPS invoice URL'; end if;
   new.stage:='linked';new.provider_checked_at:=now();
 else
   new.stage:='draft';new.provider_checked_at:=null;
 end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function rf_private.guard_invoice() from public,anon,authenticated;
create trigger guard_invoice before insert or update on royal_flush.invoices for each row execute function rf_private.guard_invoice();

-- Append audit records without exposing internal note/photo content to customers.
create function rf_private.record_field_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid; kind text; job_status text;
begin
 if auth.uid() is null or rf_private.current_role() is null then raise exception 'Company actor required'; end if;
 if tg_table_name='job_updates' then kind:='field_update';
 else kind:=case when new.stage='linked' then 'invoice_linked' else 'invoice_draft' end;end if;
 select status into job_status from royal_flush.work_orders where id=new.work_order_id;
 insert into royal_flush.work_order_events(work_order_id,actor_id,event_type,status)
 values(new.work_order_id,auth.uid(),kind,job_status) returning id into eid;
 insert into royal_flush.notification_outbox(event_id,work_order_id,event_type) values(eid,new.work_order_id,kind);
 return new;
end $$;
revoke all on function rf_private.record_field_activity() from public,anon,authenticated;
create trigger record_update after insert on royal_flush.job_updates for each row execute function rf_private.record_field_activity();
create trigger record_invoice after insert or update on royal_flush.invoices for each row execute function rf_private.record_field_activity();
commit;
