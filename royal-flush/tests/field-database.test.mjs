import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const sql=async name=>readFile(new URL('../database/'+name,import.meta.url),'utf8');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const boot=`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`;
test('private field evidence and approved billing are enforced by PostgreSQL',async t=>{
 const db=new PGlite();
 const actor=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);await db.exec('set role authenticated');};
 const admin=async query=>{await db.exec('reset role');return db.exec(query);};
 const rows=async(query,args=[])=>(await db.query(query,args)).rows;
 const post=async(id,job=101,path=null,bytes=null)=>rows('insert into royal_flush.job_updates(id,work_order_id,kind,body,photo_path,photo_bytes) values($1,$2,\'before\',\' Fixture note \' ,$3,$4) returning *',[uid(id),uid(job),path,bytes]);
 const path=(id,author=2,job=101)=>uid(job)+'/'+uid(author)+'/'+uid(id)+'.jpg';
 const upload=async name=>rows("insert into storage.objects(bucket_id,name) values('royal-flush-job-photos',$1) returning id",[name]);
 const invoice=async(id=401,items=[{description:'Service',quantity:2,unit_cents:10001}])=>rows('insert into royal_flush.invoices(id,work_order_id,line_items) values($1,$2,$3) returning *',[uid(id),uid(101),JSON.stringify(items)]);
 const link=async(url='https://connect.intuit.com/t/fixture-only')=>rows('update royal_flush.invoices set provider_url=$1,provider_invoice_number=\'FIXTURE-1\',provider_total_cents=20002 where id=$2 returning *',[url,uid(401)]);
 try{
  await db.exec(boot);await db.exec(await sql('royal_flush.sql'));await db.exec(await sql('field_and_billing.sql'));await db.exec(await sql('job_photos.sql'));
  for(let i=1;i<=6;i++)await db.query('insert into auth.users values($1)',[uid(i)]);
  for(const [id,role] of [[1,'owner'],[2,'technician'],[3,'technician'],[4,'customer'],[5,'customer'],[6,'dispatcher']])await db.query('insert into royal_flush.members values($1,$2,$3,true)',[uid(id),'Fixture '+id,role]);
  await admin('update royal_flush.settings set business_confirmed=true,legal_reviewed=true,security_reviewed=true,after_hours_routing_verified=true,approved_at=now(),intake_enabled=true');
  await actor(6);
  for(const [id,tech,start,end] of [[101,2,'14:00','15:00'],[102,3,'15:00','16:00']]){
   await db.query("insert into royal_flush.work_orders(id,customer_id,customer_name,customer_phone,street_address,city,zip_code,issue,terms_version) values($1,$2,'Sample','202-555-0100','Fictional','Panama City','32401','Water heater','rf-draft-2026-11-03')",[uid(id),uid(4)]);
   await db.query("update royal_flush.work_orders set assigned_to=$1,scheduled_start=$2,scheduled_end=$3,status='assigned' where id=$4",[uid(tech),'2030-11-04 '+start+'+00','2030-11-04 '+end+'+00',uid(id)]);
  }
  await t.test('photos and billing default closed; clients cannot enable them',async()=>{
   await actor(2);await assert.rejects(upload(path(201)),/row-level security/);await assert.rejects(post(201,101,path(201),10),/disabled/);
   await actor(6);await assert.rejects(invoice(),/Billing is disabled/);await assert.rejects(db.exec('update royal_flush.settings set photos_enabled=true'),/permission denied/);
   await admin('update royal_flush.settings set photos_enabled=true,billing_reviewed=true,billing_enabled=true');
   const bucket=(await rows('select * from storage.buckets'))[0];assert.equal(bucket.public,false);assert.equal(bucket.file_size_limit,5242880);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg']);
  });
  await t.test('only dispatcher and assigned tech post; customer never sees internal notes',async()=>{
   for(const id of [1,3,4]){await actor(id);await assert.rejects(post(201),/Only the dispatcher|row-level security/);}
   await actor(2);await assert.rejects(post(201,102),/Only the dispatcher|row-level security/);const note=(await post(201))[0];assert.equal(note.body,'Fixture note');assert.equal(note.author_name,'Fixture 2');
   await assert.rejects(db.query("insert into royal_flush.job_updates(work_order_id,author_id,kind,body) values($1,$2,'progress','spoof')",[uid(101),uid(6)]),/permission denied/);
   await actor(1);assert.equal((await rows('select * from royal_flush.job_updates')).length,1);
   await actor(4);assert.equal((await rows('select * from royal_flush.job_updates')).length,0);
  });
  await t.test('photos are private, paths are bound to job/author/update and evidence is append-only',async()=>{
   await actor(2);await assert.rejects(upload(path(202,3)),/row-level security/);await assert.rejects(upload(path(202,2,102)),/row-level security/);
   await upload(path(202));await assert.rejects(post(203,101,path(202),10),/check constraint/);await assert.rejects(post(202,101,path(202),null),/check constraint/);
   await post(202,101,path(202),10);
   assert.equal((await rows("delete from storage.objects returning id")).length,0);
   assert.equal((await rows("update storage.objects set name='tampered' returning id")).length,0);
   await assert.rejects(db.exec("update royal_flush.job_updates set body='changed'"),/permission denied/);
   await actor(1);assert.equal((await rows('select * from storage.objects')).length,1);await assert.rejects(upload(path(203,1)),/row-level security/);
   await actor(4);assert.equal((await rows('select * from storage.objects')).length,0);
   await actor(3);assert.equal((await rows('select * from storage.objects')).length,0);
   await actor(2);await upload(path(204));assert.equal((await rows('delete from storage.objects returning id')).length,1);
  });
  await t.test('only dispatcher edits invoice drafts and totals are calculated on the server',async()=>{
   for(const id of [1,2,4]){await actor(id);await assert.rejects(invoice(),/Dispatcher approval|row-level security/);}
   await actor(6);await assert.rejects(invoice(401,[{description:'Bad',quantity:1.5,unit_cents:100}]),/Invalid invoice/);
   await assert.rejects(invoice(401,[{description:'Bad',quantity:1,unit_cents:0}]),/Invalid invoice/);
   const draft=(await invoice())[0];assert.equal(draft.subtotal_cents,20002);assert.equal(draft.stage,'draft');
   await assert.rejects(db.exec('update royal_flush.invoices set subtotal_cents=1'),/permission denied/);
   await actor(2);assert.equal((await rows('select * from royal_flush.invoices')).length,0);
   await actor(4);assert.equal((await rows('select * from royal_flush.invoices')).length,0);
   await actor(1);assert.equal((await rows('select * from royal_flush.invoices')).length,1);assert.equal((await link()).length,0);
  });
  await t.test('payment handoff requires verification, correct provider and complete invoice details',async()=>{
   await actor(6);await assert.rejects(link(),/disabled/);
   await admin('update royal_flush.settings set payment_provider_verified=true,payments_enabled=true');await actor(6);
   for(const url of ['https://evil.test/x','https://connect.intuit.com.evil.test/x','javascript:alert(1)','http://connect.intuit.com/t/x'])await assert.rejects(link(url),/QuickBooks HTTPS/);
   await assert.rejects(db.query('update royal_flush.invoices set provider_url=$1 where id=$2',['https://connect.intuit.com/t/fixture',uid(401)]),/check constraint/);
   const approved=(await link())[0];assert.equal(approved.stage,'linked');assert.equal(approved.payment_status,'not_synced');
   assert.equal((await rows("update royal_flush.invoices set provider_url='https://connect.intuit.com/t/other' where version=1 returning id")).length,0);
   await assert.rejects(db.exec("update royal_flush.invoices set line_items='[]'"),/managed in QuickBooks/);
   await assert.rejects(db.exec("update royal_flush.invoices set payment_status='paid'"),/permission denied/);
   await actor(2);assert.equal((await rows('select * from royal_flush.invoices')).length,1);assert.equal((await link()).length,0);
   await actor(4);assert.equal((await rows('select * from royal_flush.invoices')).length,1);
   await actor(5);assert.equal((await rows('select * from royal_flush.invoices')).length,0);
  });
  await t.test('reassignment and revocation remove photo, note and invoice access',async()=>{
   await actor(6);await db.query('update royal_flush.work_orders set assigned_to=$1 where id=$2',[uid(3),uid(101)]);
   await actor(2);for(const table of ['job_updates','invoices'])assert.equal((await rows('select * from royal_flush.'+table)).length,0);assert.equal((await rows('select * from storage.objects')).length,0);
   await actor(3);assert.equal((await rows('select * from storage.objects')).length,1);
   await admin("update royal_flush.members set active=false where user_id='"+uid(3)+"'");await actor(3);assert.equal((await rows('select * from storage.objects')).length,0);
   await actor(1);const events=await rows('select * from royal_flush.work_order_events'),outbox=await rows('select * from royal_flush.notification_outbox');assert.equal(events.length,outbox.length);assert.ok(events.some(e=>e.event_type==='field_update'));assert.ok(events.some(e=>e.event_type==='invoice_linked'));assert.ok(outbox.every(e=>e.delivery_state==='disabled'));
  });
 }finally{await db.close();}
});
