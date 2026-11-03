-- Optional live setup, AFTER royal_flush.sql in a dedicated Supabase project.
-- Uses existing authenticated SELECT privileges and RLS. No anonymous access.
begin;
do $$
declare table_name text;
begin
  if to_regclass('public.work_orders') is not null or to_regclass('public.profiles') is not null then
    raise exception 'Refusing marketplace database: use a dedicated Royal Flush project.';
  end if;
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'Supabase Realtime publication is missing. Enable Realtime first.';
  end if;
  foreach table_name in array array['work_orders','work_order_events','members','settings','job_updates','invoices'] loop
    if not exists(select 1 from pg_publication_tables p where p.pubname='supabase_realtime'
        and p.schemaname='royal_flush' and p.tablename=table_name) then
      execute format('alter publication supabase_realtime add table royal_flush.%I',table_name);
    end if;
  end loop;
end $$;
commit;
