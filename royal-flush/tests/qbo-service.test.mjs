import test from 'node:test';
import assert from 'node:assert/strict';
import {createQboService} from '../server/qbo-service.js';
import {seal} from '../server/qbo-core.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function memoryDb(tables){
 let lease=null;
 return {tables,from(table){
  let operation='read',patch,filters=[],single=false,range;
  const builder={select(){return this;},insert(v){operation='insert';patch=v;return this;},upsert(v){operation='upsert';patch=v;return this;},update(v){operation='update';patch=v;return this;},delete(){operation='delete';return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},gt(k,v){filters.push(r=>r[k]>v);return this;},lt(k,v){filters.push(r=>r[k]<v);return this;},is(k,v){filters.push(r=>(r[k]??null)===v);return this;},not(k,op,v){filters.push(r=>(r[k]??null)!==v);return this;},order(){return this;},range(a,b){range=[a,b];return this;},single(){single=true;return this;},maybeSingle(){single=true;return this;},then(resolve,reject){
   try{
    tables[table]??=[];let rows=tables[table].filter(r=>filters.every(f=>f(r)));
    if(operation==='insert'||operation==='upsert'){
     rows=(Array.isArray(patch)?patch:[patch]).map(v=>{let target=operation==='upsert'?tables[table].find(r=>r.id===v.id):null;if(target)Object.assign(target,v);else{target={id:crypto.randomUUID(),...structuredClone(v)};tables[table].push(target);}return target;});
    }else if(operation==='update')rows.forEach(r=>Object.assign(r,structuredClone(patch)));
    else if(operation==='delete')tables[table]=tables[table].filter(r=>!rows.includes(r));
    if(range)rows=rows.slice(range[0],range[1]+1);
    resolve({data:structuredClone(single?rows[0]??null:rows),error:null});
   }catch(e){reject(e);}
  }};return builder;
 },async rpc(name,p){
  if(name==='qbo_acquire_lease'){if(lease)return {data:false};lease=p.p_id;return {data:true};}
  if(name==='qbo_release_lease'){if(lease===p.p_id)lease=null;return {data:null};}
  if(name==='qbo_reserve_invoice'){
   const draft=tables.invoices.find(i=>i.id===p.p_draft);
   if(tables.qbo_job_invoices.some(i=>i.work_order_id===draft.work_order_id))return {error:{message:'reserved'}};
   const link={id:crypto.randomUUID(),work_order_id:draft.work_order_id,draft_id:draft.id,customer_id:p.p_customer,stage:'preparing'};
   tables.qbo_job_invoices.push(link);tables.qbo_requests.push({id:p.p_id,job_invoice_id:link.id,payload:p.p_payload,state:'reserved'});return {data:link.id};
  }
 }};
}
async function fixture({timeout=false,role='dispatcher'}={}){
 const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
 const tables={members:[{user_id:id(1),role,active:true}],settings:[{id:true,quickbooks_enabled:true,business_confirmed:true,legal_reviewed:true,security_reviewed:true,billing_enabled:true,payments_enabled:false}],
 qbo_secrets:[{id:true,realm_id:'123',tokens:await seal({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Date.now()+3600000},key,'123')}],
 invoices:[{id:id(2),work_order_id:id(3),version:1,stage:'draft',subtotal_cents:12500,line_items:[{description:'Service',quantity:1,unit_cents:12500}]}],
 work_orders:[{id:id(3)}],qbo_job_invoices:[],qbo_requests:[],qbo_customers:[],qbo_items:[]};
 const db=memoryDb(tables),requests=[];
 const providerInvoice={Id:'9',CustomerRef:{value:'4'},TotalAmt:125,Balance:125,SyncToken:'0',DocNumber:'FIXTURE',Line:[{Amount:125}],CurrencyRef:{value:'USD'}};
 const handler=createQboService({db,auth:{getUser:async token=>token==='approved-token'?{data:{user:{id:id(1)}}}:{error:{message:'bad token'}}},env:{RF_APP_ORIGIN:'https://fixture.example',SUPABASE_URL:'https://fixture.supabase.co',QBO_ENVIRONMENT:'sandbox',QBO_REALM_ID:'123',QBO_CLIENT_ID:'fixture-client',QBO_CLIENT_SECRET:'fixture-secret',QBO_TOKEN_KEY:key},fetcher:async(url,options)=>{
  requests.push({url:String(url),options});
  if(String(url).includes('/customer/'))return Response.json({Customer:{Id:'4',Active:true,DisplayName:'Fixture'}});
  if(String(url).includes('/item/'))return Response.json({Item:{Id:'7',Active:true,Type:'Service',Name:'Fixture'}});
  if(options.method==='POST'&&String(url).includes('/invoice')){if(timeout)throw new Error('fixture timeout');return Response.json({Invoice:providerInvoice});}
  if(String(url).includes('/invoice/'))return Response.json({Invoice:providerInvoice});
  throw new Error('Unexpected provider request');
 }});
 const call=async(body,headers={})=>handler(new Request('https://fixture.supabase.co/functions/v1/royal-flush-qbo',{method:'POST',headers:{Origin:'https://fixture.example',Authorization:'Bearer approved-token','Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 const create={action:'create_invoice',draft_id:id(2),version:1,customer_id:'4',item_ids:['7'],tax_codes:['NON'],confirmed:true};
 return {tables,requests,call,create,providerInvoice};
}
test('gateway rejects unauthenticated and cross-origin requests before contacting QuickBooks',async()=>{
 const f=await fixture();assert.equal((await f.call(f.create,{Authorization:'Bearer invalid'})).status,401);assert.equal((await f.call(f.create,{Origin:'https://attacker.test'})).status,403);assert.equal(f.requests.length,0);
});
test('owner cannot create an invoice and stale approval cannot release one',async()=>{
 const owner=await fixture({role:'owner'});assert.equal((await owner.call(owner.create)).status,403);assert.equal(owner.requests.length,0);
 const f=await fixture();const created=await (await f.call(f.create)).json();assert.equal(created.invoice.stage,'awaiting_review');
 f.providerInvoice.TotalAmt=140;f.providerInvoice.SyncToken='1';
 assert.equal((await f.call({action:'approve_invoice',id:created.invoice.id,sync_token:'0',total_cents:12500,confirmed:true})).status,409);
 assert.equal(f.tables.qbo_job_invoices[0].stage,'awaiting_review');
});
test('uncertain provider result freezes the intent; another click cannot create a second invoice',async()=>{
 const f=await fixture({timeout:true});const first=await f.call(f.create);assert.equal(first.status,409);assert.equal((await first.json()).error,'uncertain');
 assert.equal(f.tables.qbo_requests[0].state,'uncertain');assert.equal(f.tables.qbo_job_invoices[0].stage,'attention');
 await f.call(f.create);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,1);
});
test('invoice creation does not send emails or card details; approval is a distinct office action',async()=>{
 const f=await fixture();assert.equal((await f.call({...f.create,confirmed:false})).status,400);assert.equal(f.requests.length,0);
 const r=await f.call(f.create),created=await r.json();assert.equal(r.status,200);
 const write=f.requests.find(r=>r.options.method==='POST');assert.match(write.url,/requestid=/);assert.equal(write.url.includes('/send'),false);
 assert.equal(JSON.parse(write.options.body).AllowOnlineCreditCardPayment,false);
 const approved=await f.call({action:'approve_invoice',id:created.invoice.id,sync_token:'0',total_cents:12500,confirmed:true});assert.equal(approved.status,200);assert.equal(f.tables.qbo_job_invoices[0].stage,'approved');
 f.tables.members[0].active=false;assert.equal((await f.call({action:'sync'})).status,403);
});
