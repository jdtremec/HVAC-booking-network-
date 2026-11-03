import QRCode from 'qrcode';
import {COMPANY,escapeHtml as esc,formatTime} from './domain.js';
import {UPDATE_KINDS,canPostUpdate,invoiceSubtotal,money,dollarsToCents,quickBooksUrl} from './field-domain.js';
import {preparePhoto} from './photos.js';
const fieldOption=(v,label,chosen)=>'<option value="'+esc(v)+'"'+(v===chosen?' selected':'')+'>'+esc(label)+'</option>';
const row=line=>'<div class="invoice-line"><label>Description<input name="description" required maxlength="200" value="'+esc(line.description)+'"></label><label>Quantity<input name="quantity" type="number" min="1" max="1000" step="1" required value="'+line.quantity+'"></label><label>Unit price · USD<input name="unit_price" inputmode="decimal" required value="'+(line.unit_cents/100).toFixed(2)+'"></label><button type="button" class="ghost" data-field-action="remove-line" aria-label="Remove invoice item">Remove</button></div>';
export function updatesPanel(job,data,repo){
  if(repo.profile.role==='customer')return '';
  const updates=(data.updates||[]).filter(u=>u.work_order_id===job.id);
  const canPost=canPostUpdate(repo.profile.role,repo.user.id,job),photosAllowed=repo.demo||data.settings.photos_enabled;
  return '<section class="panel field-updates" id="job-updates"><p class="eyebrow muted">Team communication · internal</p><h2>Job notes & photos</h2><p class="muted">Visible to your office, owner and assigned technician. These notes are not sent to the customer.</p>'+(canPost?'<form id="job-update-form" data-field-form><input type="hidden" name="update_id" value="'+crypto.randomUUID()+'"><input type="hidden" name="work_order_id" value="'+job.id+'"><label for="update-kind">Update type</label><select id="update-kind" name="kind">'+Object.entries(UPDATE_KINDS).map(([v,l])=>fieldOption(v,l,'progress')).join('')+'</select><label for="update-body">Message to the team</label><textarea id="update-body" name="body" maxlength="2000" required placeholder="Work completed, findings, parts needed or a question for Debra"></textarea><label for="job-photo">Attach a job photo · optional</label><input id="job-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" '+(!photosAllowed?'disabled':'')+'><p class="muted"><small>JPEG, PNG or WebP, up to 5 MB. Photos are resized and location metadata removed. '+(repo.demo?'Preview photos stay in this tab and disappear on reload.':photosAllowed?'Photos are stored privately.':'Photo uploads are not enabled yet.')+'</small></p><label class="check"><input name="photo_permission" type="checkbox"><span>If attaching a photo, I have permission to share it with the Royal Flush team. No faces, payment cards, access codes or personal documents.</span></label><button type="submit">Post team update</button><p class="form-error" role="alert"></p></form>':'<p class="notice">You can view the team’s updates here. The dispatcher and assigned technician can post.</p>')+'<div class="update-list">'+(updates.length?updates.map(u=>'<article class="field-entry"><div class="job-top"><strong>'+esc(UPDATE_KINDS[u.kind])+'</strong><small>'+esc(formatTime(u.created_at))+'</small></div><p class="field-message">'+esc(u.body)+'</p><small>'+esc(u.author_name)+'</small>'+(u.photo_path?'<p><button class="secondary" data-field-action="photo" data-update-id="'+u.id+'">View job photo</button></p>':'')+'</article>').join(''):'<p class="muted">No team notes yet.</p>')+'</div></section>';
}
export function billingPanel(job,data,repo){
  if(data.qboInvoices?.some(i=>i.work_order_id===job.id))return '<section class="panel" id="job-billing"><p>The invoice for this job is managed in the connected QuickBooks section above. Local draft editing is locked.</p></section>';
  const invoice=(data.invoices||[]).find(i=>i.work_order_id===job.id),office=repo.profile.role==='dispatcher';
  if(!invoice&&!office)return '<section class="panel" id="job-billing"><h2>Invoice & payment</h2><p class="muted">Debra prepares and approves the invoice. Approved invoices will appear here.</p></section>';
  const canBill=repo.demo||data.settings.billing_enabled;
  let body='<section class="panel billing-panel" id="job-billing"><p class="eyebrow muted">QuickBooks · office approval</p><h2>Invoice & payment</h2>';
  if(!canBill)body+='<p class="notice">Live invoice preparation is disabled pending billing review.</p>';
  if(office&&(!invoice||invoice.stage==='draft')){
    body+='<form id="invoice-form" data-field-form><input type="hidden" name="invoice_id" value="'+(invoice?.id||crypto.randomUUID())+'"><input type="hidden" name="work_order_id" value="'+job.id+'"><input type="hidden" name="invoice_version" value="'+(invoice?.version||0)+'"><fieldset '+(!canBill?'disabled':'')+'><legend>Invoice draft</legend><div class="invoice-lines">'+(invoice?.line_items||[{description:job.issue,quantity:1,unit_cents:repo.demo?12500:0}]).map(row).join('')+'</div><button type="button" class="ghost" data-field-action="add-line">+ Add item</button><p class="notice">Draft subtotal only. Review Florida tax treatment, fees and the final total in QuickBooks before approval. This draft cannot collect payment.</p><button type="submit">Save invoice draft</button><p class="form-error" role="alert"></p></fieldset></form>';
  }
  if(invoice){
    body+='<div class="invoice-summary"><span class="pill">'+(invoice.stage==='draft'?'Draft · not issued':repo.demo?'Preview approval':'QuickBooks invoice linked')+'</span><h3>'+money(invoice.stage==='linked'?invoice.provider_total_cents:invoice.subtotal_cents)+(invoice.stage==='linked'?' office-recorded invoice total':' draft subtotal')+'</h3><p class="muted">'+(invoice.stage==='draft'?'Tax and final total await office review.':'Invoice '+esc(invoice.provider_invoice_number)+' · office-recorded total '+money(invoice.provider_total_cents))+'</p><p class="notice">Payment status: '+(repo.demo?'not connected — no money can be collected.':'not synchronized. Confirm payments and current balance in QuickBooks.')+'</p><div class="actions">'+(repo.demo||['owner','dispatcher'].includes(repo.profile.role)?'<button class="secondary" data-field-action="print" data-invoice-id="'+invoice.id+'">'+(repo.demo?'Print preview invoice':'Print draft worksheet')+'</button>':'')+(invoice.stage==='linked'?'<button data-field-action="payment" data-invoice-id="'+invoice.id+'">'+(repo.demo?'Preview payment handoff':'Show invoice & payment link')+'</button>':'')+'</div></div>';
    if(office&&invoice.stage==='draft'){
      body+='<form id="invoice-link-form" data-field-form><input type="hidden" name="invoice_id" value="'+invoice.id+'"><input type="hidden" name="invoice_version" value="'+invoice.version+'"><h3>Approve the customer invoice</h3>'+(repo.demo?'<p class="muted">Try the approval step with a sample invoice. Nothing is created or sent in QuickBooks.</p>':'<fieldset '+(!data.settings.payments_enabled?'disabled':'')+'><p class="muted">Finalize this customer’s invoice in Royal Flush QuickBooks, then paste its customer-facing link here.</p><label for="provider-number">QuickBooks invoice number</label><input id="provider-number" name="provider_invoice_number" maxlength="80" required><label for="provider-total">Final invoice total · USD</label><input id="provider-total" name="provider_total" inputmode="decimal" required><label for="provider-url">Customer invoice / payment link</label><input id="provider-url" name="provider_url" type="url" placeholder="https://connect.intuit.com/…" required maxlength="2000">')+'<label class="check"><input name="approval" type="checkbox" required><span>'+ (repo.demo?'I understand this approves a fictional preview invoice only.':'I verified the Royal Flush merchant, customer, job, invoice number, matching line items, final USD total and enabled payment methods in QuickBooks. This invoice is ready for the customer.')+'</span></label><button type="submit">'+(repo.demo?'Approve preview invoice':'Link approved QuickBooks invoice')+'</button><p class="form-error" role="alert"></p>'+(repo.demo?'':'</fieldset>'+(!data.settings.payments_enabled?'<p class="notice">Payment links remain disabled until the processor and billing setup are verified.</p>':''))+'</form>';
    }
  }
  return body+'</section>';
}
export function billingOverview(data,repo){
  return '<div class="heading"><div><p class="eyebrow">Royal Flush billing</p><h1>Invoices in view.</h1><p class="muted">Debra approves invoices. QuickBooks handles customer payments and receipts.</p></div></div><p class="notice">Payment balances are not synchronized. '+(repo.demo?'All amounts here are fictional.':'Use QuickBooks to confirm whether an invoice has been paid.')+'</p><section class="panel">'+((data.invoices||[]).length?data.invoices.map(i=>{const job=data.jobs.find(j=>j.id===i.work_order_id);return '<div class="monitor-row"><div><strong>'+esc(job?.customer_name||'Service invoice')+'</strong><small>'+esc(job?.issue)+' · '+(i.stage==='draft'?'Draft':repo.demo?'Preview approval':'Linked to QuickBooks')+'</small><small>'+money(i.subtotal_cents)+' draft subtotal</small></div><button class="secondary" data-open="'+i.work_order_id+'">View job →</button></div>';}).join(''):'<p>No invoices yet. Open a job as dispatcher to prepare a draft.</p>')+'</section>';
}
export function invoiceDocument(invoice,job,demo){
  return '<div class="invoice-print-head"><div><h1>Royal Flush Plumbing</h1><p>'+esc(COMPANY.name)+'<br>'+COMPANY.phone+' · Florida license '+COMPANY.license+'</p></div><strong>'+(demo?'PREVIEW INVOICE · DO NOT PAY':'DRAFT WORKSHEET · NOT AN INVOICE')+'</strong></div><h2>Service summary · RF '+esc(job.id.slice(0,8))+'</h2><p><strong>'+esc(job.customer_name)+'</strong><br>'+esc(job.street_address)+'<br>'+esc(job.city)+', FL '+esc(job.zip_code)+'</p><table><thead><tr><th>Service</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>'+invoice.line_items.map(i=>'<tr><td>'+esc(i.description)+'</td><td>'+i.quantity+'</td><td>'+money(i.unit_cents)+'</td><td>'+money(i.quantity*i.unit_cents)+'</td></tr>').join('')+'</tbody></table><p class="invoice-total">Draft subtotal: '+money(invoice.subtotal_cents)+'</p><p>Tax treatment, fees, final total and payment terms must be finalized in QuickBooks. This worksheet is not a payment demand or receipt.</p><p>'+ (demo?'Fictional preview. No invoice was sent and no payment was processed.':'Provide the customer’s official invoice and payment receipt from QuickBooks.')+'</p>';
}
const openDialogs=new Set();
function dialog(html){
  const el=document.createElement('dialog');el.className='field-dialog';el.innerHTML='<button class="ghost dialog-close" aria-label="Close dialog">Close ×</button>'+html;document.body.append(el);
  el.querySelector('.dialog-close').onclick=()=>el.close();el.addEventListener('close',()=>{openDialogs.delete(el);el.remove();},{once:true});openDialogs.add(el);el.showModal();return el;
}
export function clearFieldMedia(){for(const el of openDialogs)el.close();document.querySelector('#invoice-print')?.remove();}
export function installFieldUI({app,context,saved}){
  app.addEventListener('click',async event=>{
    const button=event.target.closest('[data-field-action]');if(!button)return;
    const {repo,data}=context(),action=button.dataset.fieldAction,userAtClick=repo.user?.id;
    if(action==='add-line'){
      const list=button.form.querySelector('.invoice-lines');if(list.children.length<20)list.insertAdjacentHTML('beforeend',row({description:'',quantity:1,unit_cents:0}));button.form.dataset.dirty='true';return;
    }
    if(action==='remove-line'){const list=button.closest('.invoice-lines');if(list.children.length>1){button.closest('form').dataset.dirty='true';button.closest('.invoice-line').remove();}return;}
    button.disabled=true;
    try{
      if(action==='photo'){
        const userId=repo.user.id,blob=await repo.photo(button.dataset.updateId);if(repo.user?.id!==userId)return;
        const url=URL.createObjectURL(blob),el=dialog('<h2>Private job photo</h2><img class="job-photo" alt="Photo attached to the job update" src="'+esc(url)+'">');el.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
      }else{
        const invoice=data.invoices.find(i=>i.id===button.dataset.invoiceId),job=data.jobs.find(j=>j.id===invoice?.work_order_id);if(!invoice||!job)throw new Error('Refresh to view this invoice.');
        if(action==='print'){
          document.querySelector('#invoice-print')?.remove();const paper=document.createElement('section');paper.id='invoice-print';paper.innerHTML=invoiceDocument(invoice,job,repo.demo);document.body.append(paper);window.print();
        }
        if(action==='payment'){
          if(invoice.stage!=='linked')throw new Error('The office must approve the invoice first.');
          const url=repo.demo?null:quickBooksUrl(invoice.provider_url);
          if(!repo.demo&&!data.settings.payments_enabled)throw new Error('Payment handoff is currently disabled.');
          const qr=await QRCode.toDataURL(url||'ROYAL_FLUSH_PREVIEW_ONLY_NO_PAYMENT',{width:240,margin:2,errorCorrectionLevel:'M'});
          if(repo.user?.id!==userAtClick)return;
          const el=dialog('<h2>'+(repo.demo?'Preview payment handoff':'Customer invoice & payment')+'</h2><p>Invoice '+esc(invoice.provider_invoice_number)+'</p><strong class="payment-amount">'+money(invoice.provider_total_cents)+'</strong><p class="notice">'+(repo.demo?'DEMO ONLY. This code contains preview text. It cannot take a payment.':'Office-recorded invoice total, not a live balance. The customer should review the current amount and merchant on QuickBooks before paying.')+'</p><img class="payment-qr" alt="'+(repo.demo?'Demo QR code that cannot accept payment':'QR code for the approved QuickBooks customer invoice')+'" src="'+qr+'">'+(url?'<p>Ask the customer to scan with their own phone. Card or bank details are entered on QuickBooks.</p><p><a class="payment-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open QuickBooks invoice & payment page ↗</a></p><button data-copy-payment>Copy customer link</button>':'<p>In the live workflow, the office-approved invoice link opens QuickBooks for payment. No card details are collected in this preview.</p>')+'<p class="muted">Opening this screen does not confirm payment. Verify payment and provide the receipt in QuickBooks.</p><p role="status" class="copy-status"></p>');
          el.querySelector('[data-copy-payment]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);el.querySelector('.copy-status').textContent='Customer link copied.';}catch{el.querySelector('.copy-status').textContent='Copy is unavailable. Open the QuickBooks invoice page to share its link.';}});
        }
      }
    }catch(error){dialog('<h2>Unable to continue</h2><p>'+esc(error.message)+'</p>');}finally{button.disabled=false;}
  });
  app.addEventListener('submit',async event=>{
    const form=event.target;if(!form.matches('[data-field-form]'))return;event.preventDefault();
    const {repo}=context(),values=new FormData(form),output=form.querySelector('.form-error');output.textContent='';form.dataset.dirty='true';app.inert=true;
    try{
      if(form.id==='job-update-form'){
        const file=form.querySelector('[name=photo]').files[0];if(file&&!values.get('photo_permission'))throw new Error('Confirm permission before attaching a photo.');
        const photo=file?await preparePhoto(file):null;
        await repo.addUpdate({id:values.get('update_id'),work_order_id:values.get('work_order_id'),kind:values.get('kind'),body:values.get('body')},photo);
        await saved(repo.demo?'Sample team update posted in this tab. Nothing was uploaded.':'Team update posted. No customer message was sent.');
      }
      if(form.id==='invoice-form'){
        const qty=values.getAll('quantity'),price=values.getAll('unit_price');
        const line_items=values.getAll('description').map((description,i)=>({description:description.trim(),quantity:Number(qty[i]),unit_cents:dollarsToCents(price[i])}));invoiceSubtotal(line_items);
        await repo.saveInvoice({id:values.get('invoice_id'),work_order_id:values.get('work_order_id'),version:Number(values.get('invoice_version')),line_items});
        await saved('Invoice draft saved. Nothing was sent to QuickBooks or the customer.');
      }
      if(form.id==='invoice-link-form'){
        if(!values.get('approval'))throw new Error('Confirm office review before linking the invoice.');
        await repo.linkInvoice(values.get('invoice_id'),Number(values.get('invoice_version')),repo.demo?{}:{provider_invoice_number:values.get('provider_invoice_number'),provider_url:values.get('provider_url'),provider_total_cents:dollarsToCents(values.get('provider_total'))});
        await saved(repo.demo?'Preview invoice approved. No real payment link was created.':'Approved QuickBooks invoice linked. Payment status is not synchronized.');
      }
    }catch(error){output.textContent=error.message;}finally{app.inert=false;}
  });
}
