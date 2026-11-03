export const UPDATE_KINDS = {progress:'Progress update',before:'Before work',after:'After work',needs_office:'Office attention'};
export const PHOTO_LIMIT = 5 * 1024 * 1024;
export const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export function canPostUpdate(role,userId,job) {
  return role==='dispatcher'||role==='technician'&&job.assigned_to===userId&&['assigned','en_route','working','completed'].includes(job.status);
}
export function validateUpdate(value){
  if(!UPDATE_KINDS[value.kind]||typeof value.body!=='string'||!value.body.trim()||value.body.length>2000)throw new Error('Choose an update type and enter a note of up to 2,000 characters.');
  return {...value,body:value.body.trim()};
}
export function dollarsToCents(value){
  if(!/^\d{1,6}(\.\d{1,2})?$/.test(String(value)))throw new Error('Enter a dollar amount with up to two decimal places.');
  const [d,c='']=String(value).split('.');return Number(d)*100+Number(c.padEnd(2,'0'));
}
export function invoiceSubtotal(lines){
  if(!Array.isArray(lines)||!lines.length||lines.length>20)throw new Error('Add 1–20 invoice items.');
  let sum=0;
  for(const line of lines){
    if(typeof line.description!=='string'||!line.description.trim()||line.description.length>200||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>1000||!Number.isInteger(line.unit_cents)||line.unit_cents<1||line.unit_cents>10000000)throw new Error('Each invoice item needs a description, whole-number quantity and positive price.');
    sum+=line.quantity*line.unit_cents;
  }
  if(sum>100000000)throw new Error('This invoice exceeds the supported amount.');
  return sum;
}
export function quickBooksUrl(value){
  let url;try{url=new URL(value);}catch{throw new Error('Use the customer-facing QuickBooks invoice link.');}
  if(typeof value!=='string'||value.length>2000||/[\s\\]/.test(value)||url.protocol!=='https:'||url.hostname!=='connect.intuit.com'||url.username||url.password||url.port||url.pathname==='/')throw new Error('Use an HTTPS customer invoice link from connect.intuit.com.');
  return url.href;
}
export function validatePhotoFile(file){
  if(!file||file.size<1||file.size>PHOTO_LIMIT||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG or WebP photo up to 5 MB. Convert HEIC photos to JPEG first.');
}
export function photoPath(jobId,userId,updateId){return jobId+'/'+userId+'/'+updateId+'.jpg';}
