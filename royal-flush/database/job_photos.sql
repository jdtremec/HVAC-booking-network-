-- Unapplied Storage setup: run after field_and_billing.sql in the dedicated project.
begin;
do $$ begin
 if to_regclass('public.work_orders') is not null or to_regclass('public.profiles') is not null then raise exception 'Refusing marketplace database'; end if;
 if exists(select 1 from storage.buckets where id='royal-flush-job-photos') then raise exception 'Photo bucket already exists; inspect its policies before changing it'; end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('royal-flush-job-photos','royal-flush-job-photos',false,5242880,array['image/jpeg']);
create function rf_private.photo_job(path text) returns uuid language plpgsql immutable security invoker set search_path='' as $$
begin
 if path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]jpg$' then return null; end if;
 return split_part(path,'/',1)::uuid;
exception when invalid_text_representation then return null;
end $$;
revoke all on function rf_private.photo_job(text) from public,anon;
grant execute on function rf_private.photo_job(text) to authenticated;
create policy rf_photo_insert on storage.objects for insert to authenticated with check(
 bucket_id='royal-flush-job-photos' and (select photos_enabled from royal_flush.settings where id)
 and split_part(name,'/',2)=(select auth.uid())::text and rf_private.can_post_job(rf_private.photo_job(name)));
create policy rf_photo_select on storage.objects for select to authenticated using(
 bucket_id='royal-flush-job-photos' and
 (exists(select 1 from royal_flush.job_updates u where u.photo_path=name)
  or (split_part(name,'/',2)=(select auth.uid())::text and rf_private.can_post_job(rf_private.photo_job(name)))));
-- Only unreferenced uploads can be cleaned up by their uploader; posted evidence is append-only.
create policy rf_photo_orphan_delete on storage.objects for delete to authenticated using(
 bucket_id='royal-flush-job-photos' and split_part(name,'/',2)=(select auth.uid())::text
 and rf_private.can_post_job(rf_private.photo_job(name))
 and not exists(select 1 from royal_flush.job_updates u where u.photo_path=name));
-- No UPDATE/upsert policy and no public/signed URLs in the app.
commit;
