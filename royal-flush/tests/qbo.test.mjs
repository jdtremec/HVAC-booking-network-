import test from 'node:test';
import assert from 'node:assert/strict';
import {requireOffice,cents,customerRecord,itemRecord,invoiceRecord,invoicePayload,invoiceLink,seal,unseal,verifyWebhook,webhookRealms} from '../server/qbo-core.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('QuickBooks access keeps owner monitoring read-only and staff least-privileged',()=>{
 requireOffice({active:true,role:'owner'});
 for(const member of [{active:true,role:'owner'},{active:true,role:'technician'},{active:true,role:'customer'},{active:false,role:'dispatcher'},null])assert.throws(()=>requireOffice(member,true));
 requireOffice({active:true,role:'dispatcher'},true);
});
test('money and invoice normalization preserve exact cents and avoid false paid claims',()=>{
 assert.equal(cents(39.98),3998);assert.equal(cents('0.01'),1);
 for(const v of ['1.001','-1','1e3','',null,'NaN',1000001])assert.throws(()=>cents(v));
 const raw={Id:'8',CustomerRef:{value:'3'},CurrencyRef:{value:'USD'},TotalAmt:164.98,Balance:0,SyncToken:'4'};
 assert.equal(invoiceRecord(raw,'3').balance_state,'zero_balance');
 assert.throws(()=>invoiceRecord(raw,'4'),/different customer/);
 assert.throws(()=>invoiceRecord({...raw,CurrencyRef:{value:'CAD'}}),/USD/);
 assert.equal(invoiceRecord({...raw,Balance:50},'3').balance_state,'partially_settled');
 for(const url of ['https://connect.intuit.com.evil.test/x','https://user@connect.intuit.com/x','https://connect.intuit.com:444/x','javascript:alert(1)','https://connect.intuit.com/','https://connect.intuit.com/\\evil'])assert.equal(invoiceLink(url),null);
 assert.equal(invoiceLink('https://connect.intuit.com/t/fixture'),'https://connect.intuit.com/t/fixture');
});
test('outbound invoices use reviewed drafts and catalog IDs, with no internal photos or notes',()=>{
 const customer=customerRecord({Id:'3',DisplayName:'Fixture',Active:true,PrimaryEmailAddr:{Address:'fixture@example.test'},ShipAddr:{Line1:'Fictional site',CountrySubDivisionCode:'FL'}});
 const item=itemRecord({Id:'8',Name:'Service',Type:'Service',Active:true,UnitPrice:125});
 const draft={id:id(1),work_order_id:id(2),subtotal_cents:16498,line_items:[{description:'Service',quantity:1,unit_cents:12500},{description:'Parts',quantity:2,unit_cents:1999}],notes:'private note',photo_path:'private'};
 const payload=invoicePayload(draft,customer,[item,item],['NON','TAX']);
 assert.deepEqual(payload.Line.map(l=>l.Amount),[125,39.98]);assert.equal(payload.AllowOnlineCreditCardPayment,false);
 assert.equal(JSON.stringify(payload).includes('private note'),false);assert.equal(payload.BillEmail.Address,'fixture@example.test');
 assert.throws(()=>invoicePayload({...draft,subtotal_cents:1},customer,[item,item],['NON','NON']),/changed/);
 assert.throws(()=>invoicePayload(draft,customer,[{...item,active:false},item],['NON','NON']),/active/);
 assert.throws(()=>invoicePayload(draft,customer,[item,item],['','NON']),/tax/);
});
test('stored OAuth credentials are authenticated-encrypted and bound to one company',async()=>{
 const secret=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),value={access_token:'fixture-token',refresh_token:'fixture-refresh'};
 const encrypted=await seal(value,secret,'123');assert.equal(JSON.stringify(encrypted).includes('fixture-token'),false);
 assert.deepEqual(await unseal(encrypted,secret,'123'),value);
 await assert.rejects(unseal(encrypted,secret,'456'));
 await assert.rejects(unseal({...encrypted,data:encrypted.data.slice(0,-4)+'AAAA'},secret,'123'));
});
test('webhook authenticity is checked against exact raw bytes and known company shapes',async()=>{
 const body=JSON.stringify({eventNotifications:[{realmId:'123'}]}),secret='fixture-verifier';
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('base64');
 assert.equal(await verifyWebhook(body,signature,secret),true);assert.equal(await verifyWebhook(body+' ',signature,secret),false);assert.equal(await verifyWebhook(body,signature,'wrong'),false);
 assert.deepEqual(webhookRealms(JSON.parse(body)),['123']);assert.deepEqual(webhookRealms([{intuitaccountid:'123'}]),['123']);assert.deepEqual(webhookRealms({realmId:'123'}),[]);
});
