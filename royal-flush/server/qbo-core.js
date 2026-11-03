// Shared by the server and contract tests. Never import credentials into the UI.
export class QboError extends Error {
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
export function requireOffice(member,write=false){
  if(!member?.active||!(write?['dispatcher']:['owner','dispatcher']).includes(member.role))throw new QboError('forbidden','Office access is required.',403);
}
export const uuid=value=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value||''))throw new QboError('invalid_id','Invalid record.');return value;};
export const qboId=value=>{if(!/^[1-9][0-9]{0,29}$/.test(String(value||'')))throw new QboError('invalid_qbo_id','Select a valid QuickBooks record.');return String(value);};
export const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
export function cents(value){
  const match=String(value??'').match(/^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/);
  if(!match)throw new QboError('invalid_money','QuickBooks returned an unsupported amount.');
  const result=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  if(result>100000000)throw new QboError('invalid_money','Amount exceeds the supported limit.');return result;
}
export function invoiceLink(value){
  if(!value)return null;
  if(typeof value!=='string'||value.length>2000||/[\s\\]/.test(value))return null;
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='connect.intuit.com'&&!u.port&&!u.username&&!u.password&&u.pathname.length>1?u.href:null;}catch{return null;}
}
export function customerRecord(raw){
  const address=raw.ShipAddr||raw.BillAddr||{};
  return {id:qboId(raw.Id),display_name:text(raw.DisplayName),active:raw.Active===true,
    email:text(raw.PrimaryEmailAddr?.Address,254)||null,phone:text(raw.PrimaryPhone?.FreeFormNumber,30)||null,
    address:text([address.Line1,address.Line2].filter(Boolean).join(', ')),city:text(address.City,100),
    state:text(address.CountrySubDivisionCode,30),postal_code:text(address.PostalCode,20),
    provider_updated_at:validDate(raw.MetaData?.LastUpdatedTime)};
}
export function itemRecord(raw){
  return {id:qboId(raw.Id),name:text(raw.FullyQualifiedName||raw.Name),description:text(raw.Description),
    active:raw.Active===true,type:text(raw.Type,30),unit_cents:raw.UnitPrice==null?null:cents(raw.UnitPrice),
    provider_updated_at:validDate(raw.MetaData?.LastUpdatedTime)};
}
export function validDate(value){if(!value||!Number.isFinite(Date.parse(value)))return null;return new Date(value).toISOString();}
export function invoiceRecord(raw,expectedCustomer){
  if(expectedCustomer&&String(raw.CustomerRef?.value)!==String(expectedCustomer))throw new QboError('customer_mismatch','The QuickBooks invoice belongs to a different customer.',409);
  if(raw.CurrencyRef?.value&&raw.CurrencyRef.value!=='USD')throw new QboError('currency','Only USD invoices are supported.');
  const total=cents(raw.TotalAmt),balance=cents(raw.Balance);
  // Zero balance can also mean credits or a void. Never call this proof of payment.
  return {id:qboId(raw.Id),customer_id:qboId(raw.CustomerRef?.value),number:text(raw.DocNumber,80)||String(raw.Id),
    total_cents:total,balance_cents:balance,currency:'USD',due_date:/^\d{4}-\d{2}-\d{2}$/.test(raw.DueDate||'')?raw.DueDate:null,
    balance_state:balance===0?'zero_balance':balance<total?'partially_settled':'open',
    payment_url:invoiceLink(raw.InvoiceLink),sync_token:text(raw.SyncToken,40),provider_updated_at:validDate(raw.MetaData?.LastUpdatedTime)};
}
export function invoicePayload(draft,customer,items,taxCodes,paymentMethods={}){
  if(!customer?.active)throw new QboError('customer','Choose an active QuickBooks customer.');
  if(!Array.isArray(draft.line_items)||draft.line_items.length<1||draft.line_items.length>20||items.length!==draft.line_items.length||taxCodes.length!==items.length)throw new QboError('items','Match every draft line to a QuickBooks service and tax treatment.');
  let subtotal=0;
  const lines=draft.line_items.map((line,index)=>{
    const item=items[index],tax=taxCodes[index];
    if(!item?.active||!['Service','NonInventory'].includes(item.type))throw new QboError('item','Choose an active service or non-inventory item.');
    if(!['TAX','NON'].includes(tax))throw new QboError('tax','Choose the tax treatment for every line.');
    if(!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>1000||!Number.isInteger(line.unit_cents)||line.unit_cents<1||line.unit_cents>10000000||!text(line.description))throw new QboError('line','Review the invoice quantities and prices.');
    const amount=line.quantity*line.unit_cents;subtotal+=amount;
    return {Amount:amount/100,Description:text(line.description),DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{value:qboId(item.id)},Qty:line.quantity,UnitPrice:line.unit_cents/100,TaxCodeRef:{value:tax}}};
  });
  if(subtotal!==draft.subtotal_cents||subtotal>100000000)throw new QboError('changed','The draft changed. Refresh before approval.',409);
  // Do not send an invoice email, card number, internal job note or photo.
  return {CustomerRef:{value:qboId(customer.id)},CurrencyRef:{value:'USD'},Line:lines,
    PrivateNote:'Royal Flush service job '+uuid(draft.work_order_id)+'; draft '+uuid(draft.id),
    ...(customer.email?{BillEmail:{Address:customer.email}}:{}),
    AllowOnlineCreditCardPayment:paymentMethods.card===true,AllowOnlineACHPayment:paymentMethods.ach===true};
}
const bytesToBase64=bytes=>btoa(String.fromCharCode(...bytes));
const base64ToBytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function aesKey(secret){const bytes=base64ToBytes(secret);if(bytes.length!==32)throw new QboError('config','The connection is not configured.',503);return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(value,secret,realm){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(realm)},await aesKey(secret),new TextEncoder().encode(JSON.stringify(value)));return {iv:bytesToBase64(iv),data:bytesToBase64(new Uint8Array(encrypted))};}
export async function unseal(value,secret,realm){const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(value.iv),additionalData:new TextEncoder().encode(realm)},await aesKey(secret),base64ToBytes(value.data));return JSON.parse(new TextDecoder().decode(plain));}
export async function verifyWebhook(body,signature,secret){
  if(!secret||!signature||signature.length>100)return false;
  try{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('HMAC',key,base64ToBytes(signature),new TextEncoder().encode(body));}catch{return false;}
}
export function webhookRealms(payload){
  // Accept both current CloudEvents and legacy Intuit payloads. Unknown shapes fail closed.
  if(Array.isArray(payload))return payload.map(e=>String(e.intuitaccountid||'')).filter(Boolean);
  if(Array.isArray(payload?.eventNotifications))return payload.eventNotifications.map(e=>String(e.realmId||'')).filter(Boolean);
  return [];
}
