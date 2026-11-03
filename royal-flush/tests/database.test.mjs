import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const schema=await readFile(new URL('../database/royal_flush.sql',import.meta.url),'utf8');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const boot=String.raw`
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $fn$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$fn$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
`;
test('installer rejects the existing marketplace database',async()=>{
 const db=new PGlite();try{await db.exec(boot+'create table public.work_orders(id int);');await assert.rejects(db.exec(schema),/Refusing marketplace/);}finally{await db.close();}
});
test('database permissions and service workflow',async t=>{
 const db=new PGlite();
 const actor=async(n,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+role);};
 const admin=async sql=>{await db.exec('reset role');return db.exec(sql);};
 const rows=async sql=>(await db.query(sql)).rows;
 const insert=async(id,customer=4)=>db.query("insert into royal_flush.work_orders(id,customer_id,customer_name,customer_phone,street_address,city,zip_code,issue,terms_version) values($1,$2,'Sample','202-555-0100','Fictional address','Panama City Beach','32407','Water heater','rf-draft-2026-11-03') returning *",[uid(id),uid(customer)]);
 const schedule=async(id,tech=2,start='2030-11-04 14:00+00',end='2030-11-04 15:00+00')=>db.query("update royal_flush.work_orders set assigned_to=$1,scheduled_start=$2,scheduled_end=$3,status='assigned' where id=$4 returning *",[uid(tech),start,end,uid(id)]);
 try{
  await db.exec(boot);await db.exec(schema);
  for(let n=1;n<=7;n++)await db.query('insert into auth.users values($1)',[uid(n)]);
  for(const [n,role] of [[1,'owner'],[2,'technician'],[3,'technician'],[4,'customer'],[5,'customer'],[6,'dispatcher']])await db.query('insert into royal_flush.members values($1,$2,$3,true)',[uid(n),'Fixture '+n,role]);
  await t.test('real intake closed by default; staff cannot open it',async()=>{
   await actor(4);await assert.rejects(insert(101),/intake is disabled/);
   await actor(1);await assert.rejects(db.exec('update royal_flush.settings set intake_enabled=true'),/permission denied/);
   await admin('update royal_flush.settings set business_confirmed=true,legal_reviewed=true,security_reviewed=true,after_hours_routing_verified=true,approved_at=now(),intake_enabled=true');
  });
  await t.test('anonymous and marketplace-only identities have no company access',async()=>{
   await actor(null,'anon');await assert.rejects(db.exec('select * from royal_flush.work_orders'),/permission denied/);
   await actor(7);assert.equal((await rows('select * from royal_flush.members')).length,0);await assert.rejects(insert(102),/membership required/);
   await assert.rejects(db.exec("insert into royal_flush.members values('"+uid(7)+"','Intruder','owner',true)"),/permission denied/);
  });
  await t.test('customer identity cannot be spoofed and other customers cannot read jobs',async()=>{
   await actor(4);await assert.rejects(insert(103,5),/identity mismatch/);
   await insert(101);await insert(102);
   await actor(5);assert.equal((await rows('select * from royal_flush.work_orders')).length,0);
   await actor(4);await assert.rejects(db.exec("update royal_flush.members set role='owner'"),/permission denied/);
   assert.equal((await rows("update royal_flush.work_orders set status='cancelled' returning id")).length,0);
  });
  await t.test('only office can assign active company technicians; overlaps rejected',async()=>{
   await actor(2);assert.equal((await rows('select * from royal_flush.work_orders')).length,0);
   await actor(6);await assert.rejects(schedule(101,5),/active Royal Flush technician/);
   await schedule(101);await assert.rejects(schedule(102),/overlapping/);
   await schedule(102,3);
   await actor(2);assert.equal((await rows('select * from royal_flush.work_orders')).length,1);
   await assert.rejects(db.exec("update royal_flush.work_orders set assigned_to='"+uid(3)+"' where id='"+uid(101)+"'"),/Technicians can only/);
  });
  await t.test('protected fields, invalid transitions, stale updates and forged events fail',async()=>{
   await actor(2);
   await assert.rejects(db.exec("update royal_flush.work_orders set customer_name='tampered'"),/permission denied/);
   await assert.rejects(db.exec("update royal_flush.work_orders set status='completed'"),/Invalid service status/);
   assert.equal((await rows("update royal_flush.work_orders set status='en_route' where version=1 returning id")).length,0);
   await assert.rejects(db.exec("insert into royal_flush.work_order_events(work_order_id,actor_id,event_type,status) values('"+uid(101)+"','"+uid(2)+"','fake','completed')"),/permission denied/);
  });
  await t.test('assigned technician completes the sequential workflow; events are atomic',async()=>{
   await actor(2);
   for(const status of ['en_route','working','completed'])await db.query("update royal_flush.work_orders set status=$1 where id=$2",[status,uid(101)]);
   const job=(await rows("select * from royal_flush.work_orders where id='"+uid(101)+"'"))[0];assert.equal(job.status,'completed');assert.equal(job.version,5);
   await actor(1);
   assert.equal((await rows('select count(*)::int as n from royal_flush.work_order_events'))[0].n,7);
   assert.equal((await rows('select count(*)::int as n from royal_flush.notification_outbox'))[0].n,7);
   assert.equal((await rows("select count(*)::int as n from royal_flush.notification_outbox where delivery_state<>'disabled'"))[0].n,0);
   await assert.rejects(db.exec("update royal_flush.notification_outbox set delivery_state='sent'"),/permission denied/);
   await assert.rejects(db.exec('delete from royal_flush.work_orders'),/permission denied/);
  });
  await t.test('revoked staff lose data access immediately',async()=>{
   await admin("update royal_flush.members set active=false where user_id='"+uid(3)+"'");
   await actor(3);assert.equal((await rows('select * from royal_flush.work_orders')).length,0);assert.equal((await rows('select * from royal_flush.work_order_events')).length,0);
  });
 }finally{await db.close();}
});

