import test from 'node:test';
import assert from 'node:assert/strict';
import {dollarsToCents,invoiceSubtotal,quickBooksUrl,validateUpdate,validatePhotoFile,canPostUpdate} from '../src/field-domain.js';
import {DemoRepository} from '../src/repository.js';
const lines=[{description:'Labor',quantity:2,unit_cents:10001},{description:'Part',quantity:1,unit_cents:1599}];
test('invoice amounts use integer cents and reject unsafe or unsupported inputs',()=>{
 assert.equal(dollarsToCents('100.01'),10001);assert.equal(dollarsToCents('1.1'),110);assert.equal(invoiceSubtotal(lines),21601);
 for(const value of ['1e3','-1','1.001','Infinity',' 5','1,000'])assert.throws(()=>dollarsToCents(value));
 for(const patch of [{quantity:0},{quantity:1.5},{quantity:1001},{unit_cents:0},{unit_cents:1.1},{description:' '}])assert.throws(()=>invoiceSubtotal([{...lines[0],...patch}]));
 assert.throws(()=>invoiceSubtotal(Array(21).fill(lines[0])));assert.throws(()=>invoiceSubtotal([{...lines[0],quantity:1000,unit_cents:10000000}]));
});
test('customer links allow only the exact QuickBooks hosted origin',()=>{
 assert.equal(quickBooksUrl('https://connect.intuit.com/t/example'),'https://connect.intuit.com/t/example');
 for(const url of ['javascript:alert(1)','http://connect.intuit.com/t/x','https://connect.intuit.com.attacker.test/t/x','https://attacker.test/connect.intuit.com','https://name:pass@connect.intuit.com/t/x','https://connect.intuit.com:444/t/x','https://connect.intuit.com/','https://connect.intuit.com\\@attacker.test/t/x'])assert.throws(()=>quickBooksUrl(url));
});
test('field updates validate content, assignment and photo size/type',()=>{
 assert.equal(validateUpdate({kind:'after',body:' Done '}).body,'Done');
 assert.throws(()=>validateUpdate({kind:'after',body:' '}));assert.throws(()=>validateUpdate({kind:'invented',body:'Note'}));
 assert.equal(canPostUpdate('owner','a',{assigned_to:'a',status:'working'}),false);
 assert.equal(canPostUpdate('technician','a',{assigned_to:'b',status:'working'}),false);
 assert.equal(canPostUpdate('technician','a',{assigned_to:'a',status:'completed'}),true);
 for(const file of [{type:'image/svg+xml',size:20},{type:'image/heic',size:20},{type:'image/jpeg',size:5242881}])assert.throws(()=>validatePhotoFile(file));
});
test('preview updates and invoices respect role boundaries and never create paid transactions',async()=>{
 const repo=new DemoRepository(),job=repo.jobs[1];repo.setRole('technician');
 const update={id:crypto.randomUUID(),work_order_id:job.id,kind:'before',body:'Fictional observation'};
 await repo.addUpdate(update,new Blob(['photo'],{type:'image/jpeg'}));await repo.addUpdate(update);
 assert.equal((await repo.load()).updates.length,1);
 await assert.rejects(repo.saveInvoice({}),/dispatcher/);
 repo.setRole('owner');assert.equal((await repo.load()).updates.length,1);assert.equal((await repo.photo(update.id)).size,5);
 await assert.rejects(repo.addUpdate({...update,id:crypto.randomUUID()}),/assigned technician/);
 repo.setRole('customer');assert.equal((await repo.load()).updates.length,0);await assert.rejects(repo.photo(update.id),/access/);
 repo.setRole('dispatcher');const invoice=await repo.saveInvoice({id:crypto.randomUUID(),work_order_id:job.id,line_items:lines,version:0});
 repo.setRole('technician');assert.equal((await repo.load()).invoices.length,0);await assert.rejects(repo.linkInvoice(invoice.id,1),/dispatcher/);
 repo.setRole('dispatcher');await repo.linkInvoice(invoice.id,1);
 repo.setRole('technician');const approved=(await repo.load()).invoices[0];assert.equal(approved.stage,'linked');assert.equal(approved.provider_url,null);assert.equal(approved.payment_status,'not_synced');
 repo.setRole('dispatcher');await assert.rejects(repo.saveInvoice({...approved,line_items:lines}),/managed in QuickBooks/);
});
