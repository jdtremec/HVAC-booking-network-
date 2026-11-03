import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('QuickBooks tables, reservations and secrets enforce roles inside PostgreSQL',async()=>{
 const db=new PGlite();
 const admin=async()=>db.exec('reset role');
 const actor=async n=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated');};
 const sql=async file=>db.exec(await readFile(new URL('../database/'+file,import.meta.url),'utf8'));
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  await sql('royal_flush.sql');await sql('field_and_billing.sql');await sql('quickbooks.sql');
  for(const [n,role] of [[1,'owner'],[2,'dispatcher'],[3,'technician'],[4,'technician'],[5,'customer']]){
   await db.query('insert into auth.users values($1)',[id(n)]);await db.query('insert into royal_flush.members values($1,$2,$3,true)',[id(n),'Fixture '+n,role]);
  }
  await db.exec('update royal_flush.settings set business_confirmed=true,legal_reviewed=true,security_reviewed=true,after_hours_routing_verified=true,approved_at=now(),intake_enabled=true,billing_reviewed=true,billing_enabled=true,quickbooks_enabled=true');
  await actor(2);await db.query("insert into royal_flush.work_orders(id,customer_name,customer_phone,street_address,city,zip_code,issue,terms_version) values($1,'Fixture','202-555-0100','Fictional','Panama City','32401','Water heater','rf-draft-2026-11-03')",[id(101)]);
  await db.query("update royal_flush.work_orders set assigned_to=$1,scheduled_start='2030-11-04T14:00Z',scheduled_end='2030-11-04T15:00Z',status='assigned' where id=$2",[id(3),id(101)]);
  await db.query('insert into royal_flush.invoices(id,work_order_id,line_items) values($1,$2,$3)',[id(201),id(101),JSON.stringify([{description:'Fixture',quantity:1,unit_cents:100}])]);
  for(const n of [1,2,3,4,5]){
   await actor(n);for(const table of ['qbo_secrets','qbo_oauth_states','qbo_requests','qbo_webhooks'])await assert.rejects(db.exec('select * from royal_flush.'+table),/permission denied/);
   await assert.rejects(db.query('select royal_flush.qbo_acquire_lease($1)',[id(99)]),/permission denied/);
   await assert.rejects(db.exec("update royal_flush.qbo_connection set status='connected'"),/permission denied/);
  }
  await admin();await db.exec('set role service_role');
  await db.exec("insert into royal_flush.qbo_customers(id,display_name,active) values('1','Fixture',true)");
  assert.equal((await db.query('select royal_flush.qbo_acquire_lease($1) as acquired',[id(99)])).rows[0].acquired,true);
  assert.equal((await db.query('select royal_flush.qbo_acquire_lease($1) as acquired',[id(98)])).rows[0].acquired,false);
  await db.query('select royal_flush.qbo_release_lease($1)',[id(98)]);assert.equal((await db.query('select royal_flush.qbo_acquire_lease($1) as acquired',[id(98)])).rows[0].acquired,false);
  const reserve=(actorId,version=1)=>db.query("select royal_flush.qbo_reserve_invoice($1,$2,$3,'1','{}',$4) as id",[id(actorId),id(201),version,id(301)]);
  await assert.rejects(reserve(1),/Dispatcher/);await assert.rejects(reserve(2,999),/Draft changed/);
  const link=(await reserve(2)).rows[0].id;await assert.rejects(reserve(2),/already reserved/);
  await actor(2);await assert.rejects(db.exec("update royal_flush.invoices set line_items='[{\"description\":\"changed\",\"quantity\":1,\"unit_cents\":99}]'"),/reserved/);
  await actor(1);assert.equal((await db.exec('select * from royal_flush.qbo_customers'))[0].rows.length,1);assert.equal((await db.exec('select * from royal_flush.qbo_job_invoices'))[0].rows.length,1);
  await actor(3);assert.equal((await db.exec('select * from royal_flush.qbo_customers'))[0].rows.length,0);assert.equal((await db.exec('select * from royal_flush.qbo_job_invoices'))[0].rows.length,0);
  await admin();await db.query("update royal_flush.qbo_job_invoices set provider_id='12',number='FIXTURE',total_cents=100,balance_cents=100,stage='approved',approved_by=$1,approved_at=now(),approved_total_cents=100 where id=$2",[id(2),link]);
  await actor(3);assert.equal((await db.exec('select * from royal_flush.qbo_job_invoices'))[0].rows.length,1);
  for(const n of [4,5]){await actor(n);assert.equal((await db.exec('select * from royal_flush.qbo_job_invoices'))[0].rows.length,0);}
  await actor(2);await db.query('update royal_flush.work_orders set assigned_to=$1 where id=$2',[id(4),id(101)]);
  await actor(3);assert.equal((await db.exec('select * from royal_flush.qbo_job_invoices'))[0].rows.length,0);
 }finally{await db.close();}
});
