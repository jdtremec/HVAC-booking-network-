-- Home Services Dispatch: initial secure schema (review before applying)
-- Run ONLY in your own Supabase project's SQL editor; no live data in GitHub.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '',
 role text not null default 'customer' check (role in ('customer','dispatcher','admin','contractor')),
 created_at timestamptz not null default now()
);
create table if not exists public.contractors (
 id uuid primary key default gen_random_uuid(),
 business_name text not null,
 trade text not null check (trade in ('HVAC','Plumbing')),
 phone text,
 status text not null default 'pending' check (status in ('pending','approved','suspended')),
 license_verified boolean not null default false,
 insurance_verified boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.contractor_members (
 contractor_id uuid not null references public.contractors(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key (contractor_id,user_id)
);
create table if not exists public.contractor_coverage (
 contractor_id uuid not null references public.contractors(id) on delete cascade,
 zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
 primary key(contractor_id,zip_code)
);
create table if not exists public.contractor_availability (
 id uuid primary key default gen_random_uuid(),
 contractor_id uuid not null references public.contractors(id) on delete cascade,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'open' check (status in ('open','blocked','booked')),
 check (ends_at > starts_at)
);
create table if not exists public.contractor_rates (
 contractor_id uuid primary key references public.contractors(id) on delete cascade,
 minimum_fee numeric(10,2) not null default 0 check(minimum_fee >= 0),
 callout_fee numeric(10,2) not null default 0 check(callout_fee >= 0),
 diagnostic_fee numeric(10,2) not null default 0 check(diagnostic_fee >= 0),
 hourly_fee numeric(10,2) not null default 0 check(hourly_fee >= 0),
 updated_at timestamptz not null default now()
);
create table if not exists public.work_orders (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid references auth.users(id) on delete set null,
 customer_name text not null,
 customer_phone text not null,
 street_address text not null,
 city text not null,
 zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
 trade text not null check (trade in ('HVAC','Plumbing')),
 issue text not null,
 preferred_start timestamptz not null,
 status text not null default 'new' check(status in ('new','broadcasting','needs_manual_dispatch','provider_accepted','awaiting_customer','confirmed','completed','cancelled')),
 assigned_contractor_id uuid references public.contractors(id),
 claimed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.dispatch_calls (
 id uuid primary key default gen_random_uuid(),
 work_order_id uuid not null references public.work_orders(id) on delete cascade,
 contractor_id uuid references public.contractors(id),
 operator_id uuid not null references auth.users(id),
 outcome text not null check (outcome in ('no_answer','declined','callback','available','accepted')),
 notes text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.work_order_events (
 id bigint generated always as identity primary key,
 work_order_id uuid not null references public.work_orders(id) on delete cascade,
 actor_id uuid references auth.users(id),
 event_type text not null,
 event_details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists idx_work_orders_status on public.work_orders(status,created_at desc);
create index if not exists idx_work_orders_zip on public.work_orders(zip_code,trade);
create index if not exists idx_dispatch_calls_order on public.dispatch_calls(work_order_id,created_at desc);
create index if not exists idx_availability_contractor_time on public.contractor_availability(contractor_id,starts_at);
create or replace function public.is_dispatch_staff() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','dispatcher'));
$$;
create or replace function public.is_contractor_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.contractor_members where contractor_id=cid and user_id=auth.uid());
$$;
alter table public.profiles enable row level security;
alter table public.contractors enable row level security;
alter table public.contractor_members enable row level security;
alter table public.contractor_coverage enable row level security;
alter table public.contractor_availability enable row level security;
alter table public.contractor_rates enable row level security;
alter table public.work_orders enable row level security;
alter table public.dispatch_calls enable row level security;
alter table public.work_order_events enable row level security;
-- Staff can read and manage operational records. No anonymous work-order access.
create policy profiles_self_or_staff_read on public.profiles for select to authenticated
 using (id=auth.uid() or public.is_dispatch_staff());
create policy contractors_staff_read on public.contractors for select to authenticated
 using(public.is_dispatch_staff() or public.is_contractor_member(id));
create policy contractors_staff_write on public.contractors for all to authenticated
 using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy members_staff_read on public.contractor_members for select to authenticated
 using(public.is_dispatch_staff() or user_id=auth.uid());
create policy members_staff_write on public.contractor_members for all to authenticated
 using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy coverage_staff_read on public.contractor_coverage for select to authenticated
 using(public.is_dispatch_staff() or public.is_contractor_member(contractor_id));
create policy coverage_staff_write on public.contractor_coverage for all to authenticated
 using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy availability_staff_read on public.contractor_availability for select to authenticated
 using(public.is_dispatch_staff() or public.is_contractor_member(contractor_id));
create policy availability_staff_write on public.contractor_availability for all to authenticated
 using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy rates_staff_read on public.contractor_rates for select to authenticated
 using(public.is_dispatch_staff() or public.is_contractor_member(contractor_id));
create policy rates_staff_write on public.contractor_rates for all to authenticated
 using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy workorders_staff_or_owner_read on public.work_orders for select to authenticated
 using(public.is_dispatch_staff() or customer_id=auth.uid() or public.is_contractor_member(assigned_contractor_id));
create policy workorders_staff_write on public.work_orders for all to authenticated
 using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy calls_staff_read on public.dispatch_calls for select to authenticated using(public.is_dispatch_staff());
create policy calls_staff_write on public.dispatch_calls for all to authenticated using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
create policy events_staff_read on public.work_order_events for select to authenticated using(public.is_dispatch_staff());
create policy events_staff_write on public.work_order_events for all to authenticated using(public.is_dispatch_staff()) with check(public.is_dispatch_staff());
-- IMPORTANT: Do not self-assign admin roles through client apps.
-- First admins must be provisioned by a trusted server-side administrative process.
-- Guest orders, contractor acceptances, atomic claims, and notifications must use secured edge functions with validation/rate limits.
-- Avoid granting table INSERT to anon users or letting contractors alter status directly.
