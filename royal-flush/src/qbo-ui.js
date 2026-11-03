import {escapeHtml as esc,formatTime} from './domain.js';
import {money,quickBooksUrl} from './field-domain.js';
const office=repo=>['owner','dispatcher'].includes(repo.profile?.role);
const option=(id,label)=>'<option value="'+esc(id)+'">'+esc(label)+'</option>';
export function qboIntake(data,repo){
 if(repo.demo||repo.profile.role!=='dispatcher'||!data.settings.quickbooks_enabled)return '';
 return '<section class="panel"><h2>Use a QuickBooks customer</h2><form data-qbo-form="intake_search"><label>Customer name<input name="term" required minlength="2" maxlength="80"></label><button>Find customer</button><p class="form-error" role="alert"></p></form><div class="qbo-intake-results"></div><p class="muted">Confirm the service address and phone with the customer. The QuickBooks billing address may differ.</p></section>';
}
export function qboOverview(data,repo){
  const c=data.qboConnection;
  return '<div class="heading"><div><p class="eyebrow">Royal Flush · connected books</p><h1>QuickBooks connection</h1><p class="muted">One company record for customers, services and billing.</p></div></div><section class="panel"><h2>'+(repo.demo?'Preview · QuickBooks is not connected':c?.status==='connected'?esc(c.company_name||'QuickBooks connected'):'Connection setup required')+'</h2><p class="notice">'+(repo.demo?'This page shows the planned workflow. No QuickBooks customer data is loaded, no invoice is created and no payment is collected.':c?.last_sync_at?'Last successful sync: '+esc(formatTime(c.last_sync_at))+'. Amounts can change in QuickBooks after this time.':'No QuickBooks synchronization has completed.')+'</p><div class="actions">'+(!repo.demo&&repo.profile.role==='owner'?'<button data-qbo-action="connect">Connect Royal Flush QuickBooks</button>':'')+(!repo.demo&&data.settings.quickbooks_enabled?'<button class="secondary" data-qbo-action="sync">Refresh from QuickBooks</button>':'')+'</div><p class="qbo-error" role="alert"></p></section><div class="form-grid"><section class="panel"><h2>QuickBooks → service team</h2><ul><li>Customer contact and service address details for the office.</li><li>Service items to match invoice lines.</li><li>Invoice totals, outstanding balances and customer payment links.</li></ul><p class="muted">Technicians see approved invoices for their assigned jobs. A zero balance is shown as a zero balance; it may include credits or a void, not only payments.</p></section><section class="panel"><h2>Service team → QuickBooks</h2><ul><li>Debbie reviews the customer, work and prices.</li><li>She matches service items and tax treatment, then creates the invoice.</li><li>QuickBooks calculates the final total. Debbie checks it before releasing it to the technician.</li></ul><p class="muted">Job photos and internal notes stay in the service workspace. Customer payment details are entered on QuickBooks.</p></section></div><section class="panel"><h2>Connection status</h2><p>'+(repo.demo?'Live authorization and merchant verification are still required.':data.settings.quickbooks_enabled?'Data synchronization is enabled. Refresh from QuickBooks when checking a balance.':'Customer imports and financial actions are closed until the live setup is approved.')+'</p><p class="muted">The QuickBooks connection in this chat does not automatically connect the staff website. The website needs a separate owner authorization. Background synchronization and after-hours alerts require their own live setup.</p></section>';
}
export function qboJobPanel(job,data,repo){
  const invoice=(data.qboInvoices||[]).find(i=>i.work_order_id===job.id),canEdit=repo.profile.role==='dispatcher';
  if(!invoice&&!office(repo))return '';
  let html='<section class="panel" id="quickbooks-job"><p class="eyebrow muted">QuickBooks sync</p><h2>Connected invoice</h2>';
  if(repo.demo)return html+'<p class="notice">QuickBooks connection is not active in this preview. Use the invoice draft below to try the office workflow.</p></section>';
  if(!data.settings.quickbooks_enabled)return html+'<p class="notice">QuickBooks setup is not complete. No invoice will be created from here.</p></section>';
  if(invoice){
    html+='<p><strong>'+esc(invoice.number?'Invoice '+invoice.number:'Invoice awaiting confirmation')+'</strong> · '+esc(invoice.stage.replaceAll('_',' '))+'</p>';
    if(invoice.provider_id)html+='<p>Invoice total: <strong>'+money(invoice.total_cents)+'</strong><br>Balance: <strong>'+money(invoice.balance_cents)+'</strong></p><p class="muted">Checked '+esc(formatTime(invoice.synced_at))+'. '+(invoice.balance_state==='zero_balance'?'Zero balance can include credits or a void; confirm the payment receipt in QuickBooks.':'QuickBooks may have changed since this check.')+'</p>';
    if(invoice.stage==='attention'||invoice.stage==='preparing')html+='<p class="notice">Check QuickBooks before making another invoice. The previous result is not confirmed.</p>';
    if(invoice.stage==='approved'&&invoice.payment_url&&data.settings.payments_enabled)html+='<p><a class="payment-link" href="'+esc(quickBooksUrl(invoice.payment_url))+'" target="_blank" rel="noopener noreferrer">Open approved QuickBooks invoice & payment ↗</a></p>';
    if(invoice.provider_id&&canEdit&&invoice.stage!=='approved')html+='<form data-qbo-form="approve"><input type="hidden" name="id" value="'+invoice.id+'"><input type="hidden" name="sync_token" value="'+esc(invoice.sync_token)+'"><input type="hidden" name="total_cents" value="'+invoice.total_cents+'"><label class="check"><input type="checkbox" name="confirmed" required><span>I checked the customer, completed work, final total, tax treatment and payment terms in QuickBooks. Release this invoice to the assigned technician.</span></label><button>Release approved invoice</button><p class="form-error" role="alert"></p></form>';
  }
  if(canEdit&&(!invoice||!invoice.provider_id)){
    const draft=data.invoices.find(i=>i.work_order_id===job.id);
    html+='<button class="secondary" data-qbo-action="prepare" data-job-id="'+job.id+'" '+(draft?.stage==='linked'?'disabled':'')+'>Choose QuickBooks customer & invoice</button><p class="muted">Use an existing invoice or create one from the saved draft. No email is sent automatically.</p>';
  }
  return html+'<p class="qbo-error" role="alert"></p></section>';
}
export function installQboUI({app,context,saved}){
  const fail=(node,error)=>{const output=node.querySelector('.qbo-error,.form-error');if(output)output.textContent=error.message;};
  app.addEventListener('click',async event=>{
    const button=event.target.closest('[data-qbo-action]');if(!button)return;
    const {repo,data}=context(),panel=button.closest('section');if(!office(repo)||repo.demo)return;
    const actor=repo.user.id;button.disabled=true;
    try{
      if(button.dataset.qboAction==='connect'){
        const result=await repo.qbo('connect');if(repo.user?.id!==actor)return;
        const url=new URL(result.url);if(url.origin!=='https://appcenter.intuit.com')throw new Error('Invalid authorization address.');
        const anchor=document.createElement('a');anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent='Continue to secure QuickBooks authorization ↗';panel.append(anchor);
      }
      if(button.dataset.qboAction==='sync'){await repo.qbo('sync');await saved('QuickBooks refresh completed. Check each invoice’s latest balance timestamp.');}
      if(button.dataset.qboAction==='use_customer'){
        const r=await repo.client.from('qbo_customers').select('display_name,phone,address,city,state,postal_code').eq('id',button.dataset.customerId).eq('active',true).single();
        if(r.error)throw new Error('Refresh the customer list.');if(repo.user?.id!==actor)return;
        const c=r.data;if(!['FL','Florida'].includes(c.state))throw new Error('The QuickBooks address is not confirmed as Florida. Enter and confirm the service address manually.');
        const request=app.querySelector('#request-form');
        for(const [key,value] of Object.entries({customer_name:c.display_name,customer_phone:c.phone||'',street_address:c.address||'',zip_code:(c.postal_code||'').slice(0,5)}))request.elements[key].value=value;
        const city=request.elements.city;if([...city.options].some(o=>o.value===c.city))city.value=c.city;
        request.dataset.dirty='true';panel.querySelector('.qbo-error').textContent='Customer details copied. Confirm the service area, address and phone before saving.';
      }
      if(button.dataset.qboAction==='prepare'){
        if(repo.profile.role!=='dispatcher')return;
        const job=data.jobs.find(j=>j.id===button.dataset.jobId),draft=data.invoices.find(i=>i.work_order_id===job?.id);
        panel.querySelector('.qbo-preparation')?.remove();
        panel.insertAdjacentHTML('beforeend','<div class="qbo-preparation"><form data-qbo-form="search"><input type="hidden" name="job_id" value="'+job.id+'"><label>Find existing QuickBooks customer<input name="term" minlength="2" maxlength="80" required autocomplete="off"></label><button>Search customers</button><p class="form-error" role="alert"></p></form><div class="qbo-choices"></div><p class="muted">'+(draft?'Saved draft: '+money(draft.subtotal_cents)+'.':'Save a draft below before creating an invoice.')+'</p></div>');
      }
    }catch(error){fail(panel,error);}finally{button.disabled=false;}
  });
  app.addEventListener('submit',async event=>{
    const form=event.target;if(!form.matches('[data-qbo-form]'))return;event.preventDefault();
    const {repo,data}=context(),values=new FormData(form),action=form.dataset.qboForm,actor=repo.user?.id;
    if(repo.demo||repo.profile?.role!=='dispatcher')return;
    form.dataset.dirty='true';form.querySelector('.form-error').textContent='';app.inert=true;
    try{
      if(action==='intake_search'){
        const customers=await repo.qboCustomers(values.get('term'));if(repo.user?.id!==actor)return;
        form.parentElement.querySelector('.qbo-intake-results').innerHTML=customers.length?customers.map(c=>'<div class="monitor-row"><div><strong>'+esc(c.display_name)+'</strong><small>'+esc(c.address)+' · '+esc(c.city)+'</small></div><button type="button" class="secondary" data-qbo-action="use_customer" data-customer-id="'+esc(c.id)+'">Use customer</button></div>').join('')+'<p class="qbo-error" role="status"></p>':'<p>No matching imported customer. Refresh the QuickBooks connection first.</p>';
      }
      if(action==='search'){
        const customers=await repo.qboCustomers(values.get('term'));if(repo.user?.id!==actor)return;
        const box=form.parentElement.querySelector('.qbo-choices'),jobId=values.get('job_id');
        box.innerHTML=customers.length?'<form data-qbo-form="customer"><input type="hidden" name="job_id" value="'+jobId+'"><label>QuickBooks customer<select name="customer_id" required><option value="">Choose the matching customer</option>'+customers.map(c=>option(c.id,c.display_name+' · '+(c.address||c.email||'check contact details'))).join('')+'</select></label><button>Load customer invoices & services</button><p class="form-error" role="alert"></p></form>':'<p>No matching imported customer. Refresh from QuickBooks, or add the customer in QuickBooks first.</p>';
      }
      if(action==='customer'){
        const [result,items]=await Promise.all([repo.qbo('customer_invoices',{customer_id:values.get('customer_id')}),repo.qboItems()]);if(repo.user?.id!==actor)return;
        const jobId=values.get('job_id'),draft=data.invoices.find(i=>i.work_order_id===jobId),prior=data.qboInvoices?.find(i=>i.work_order_id===jobId);
        form.parentElement.querySelector('.qbo-options')?.remove();
        let html='<div class="qbo-options"><form data-qbo-form="link"><input type="hidden" name="work_order_id" value="'+jobId+'"><input type="hidden" name="customer_id" value="'+esc(values.get('customer_id'))+'"><h3>Use an existing invoice</h3><label>Recent QuickBooks invoices<select name="invoice_id" required><option value="">Choose the invoice for this job</option>'+result.invoices.map(i=>option(i.id,i.number+' · total '+money(i.total_cents)+' · balance '+money(i.balance_cents))).join('')+'</select></label><label class="check"><input type="checkbox" name="confirmed" required><span>I verified this invoice and customer belong to this service job.</span></label><button>Link for final review</button><p class="form-error" role="alert"></p></form>';
        if(draft?.stage==='draft'&&!prior)html+='<form data-qbo-form="create"><input type="hidden" name="draft_id" value="'+draft.id+'"><input type="hidden" name="version" value="'+draft.version+'"><input type="hidden" name="customer_id" value="'+esc(values.get('customer_id'))+'"><h3>Create from saved draft</h3>'+draft.line_items.map(line=>'<fieldset><legend>'+esc(line.description)+' · '+money(line.quantity*line.unit_cents)+'</legend><label>QuickBooks service<select name="item_id" required><option value="">Choose service</option>'+items.map(i=>option(i.id,i.name)).join('')+'</select></label><label>Tax treatment<select name="tax_code" required><option value="">Choose approved treatment</option><option value="NON">Non-taxable</option><option value="TAX">Taxable · calculated in QuickBooks</option></select></label></fieldset>').join('')+'<label class="check"><input type="checkbox" name="confirmed" required><span>I reviewed the customer, work, quantities, prices and tax treatment. Create one real invoice in Royal Flush QuickBooks. I will review the final total before releasing it.</span></label><button>Create invoice in QuickBooks</button><p class="form-error" role="alert"></p></form>';
        form.parentElement.insertAdjacentHTML('beforeend',html+'</div>');
      }
      if(['create','link','approve'].includes(action)){
        const input=Object.fromEntries(values);input.confirmed=values.get('confirmed')==='on';
        if(action==='create'){input.version=Number(input.version);input.item_ids=values.getAll('item_id');input.tax_codes=values.getAll('tax_code');}
        if(action==='approve')input.total_cents=Number(input.total_cents);
        await repo.qbo(action+'_invoice',input);if(repo.user?.id!==actor)return;
        await saved(action==='approve'?'QuickBooks invoice released to the assigned technician. No email was sent.':'QuickBooks invoice saved for final review. No email was sent.');
      }
    }catch(error){fail(form,error);}finally{app.inert=false;}
  });
}
