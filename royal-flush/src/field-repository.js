import {canPostUpdate,validateUpdate,invoiceSubtotal,quickBooksUrl,photoPath,PHOTO_LIMIT} from './field-domain.js';
const officeOnly=repo=>{if(repo.profile?.role!=='dispatcher')throw new Error('Only Debra’s dispatcher role can prepare and approve invoices.');};
const validBlob=blob=>{if(blob&&(blob.type!=='image/jpeg'||blob.size<1||blob.size>PHOTO_LIMIT))throw new Error('Prepare a JPEG photo under 5 MB.');};
const problem=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
export const demoFieldMethods={
  async addUpdate(input,blob){
    const value=validateUpdate(input),job=this.jobs.find(j=>j.id===value.work_order_id);
    if(!job||!canPostUpdate(this.profile.role,this.user.id,job))throw new Error('Only the dispatcher or assigned technician can post updates.');
    validBlob(blob);
    const prior=this.updates.find(u=>u.id===value.id);if(prior){if(prior.author_id!==this.user.id)throw new Error('Update ID already used.');return prior;}
    const update={...value,author_id:this.user.id,author_name:this.profile.display_name,photo_path:blob?photoPath(job.id,this.user.id,value.id):null,photo_bytes:blob?.size||null,created_at:new Date().toISOString()};
    this.updates.unshift(update);if(blob)this.photos.set(update.id,blob);this.record(job,'field_update');return update;
  },
  async photo(id){
    const visible=(await this.load()).updates.find(u=>u.id===id);if(!visible)throw new Error('Photo access is unavailable.');
    const blob=this.photos.get(id);if(!blob)throw new Error('This photo is unavailable.');return blob;
  },
  async saveInvoice({id,work_order_id,line_items,version}){
    officeOnly(this);const job=this.jobs.find(j=>j.id===work_order_id);if(!job)throw new Error('Job not found.');
    const subtotal_cents=invoiceSubtotal(line_items),prior=this.invoices.find(i=>i.work_order_id===work_order_id);
    if(prior&&(prior.id!==id||prior.version!==version))throw new Error('The invoice changed. Refresh before saving.');
    if(prior?.stage==='linked')throw new Error('The linked invoice is managed in QuickBooks.');
    const invoice={id,work_order_id,line_items:structuredClone(line_items),subtotal_cents,currency:'USD',stage:'draft',payment_status:'not_synced',version:(prior?.version||0)+1,created_at:prior?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};
    if(prior)Object.assign(prior,invoice);else this.invoices.unshift(invoice);this.record(job,'invoice_draft');return invoice;
  },
  async linkInvoice(id,version){
    officeOnly(this);const invoice=this.invoices.find(i=>i.id===id);
    if(!invoice||invoice.version!==version||invoice.stage!=='draft')throw new Error('The invoice changed. Refresh before approval.');
    Object.assign(invoice,{stage:'linked',provider_invoice_number:'PREVIEW-'+id.slice(0,8).toUpperCase(),provider_url:null,provider_total_cents:invoice.subtotal_cents,provider_checked_at:new Date().toISOString(),version:version+1});
    this.record(this.jobs.find(j=>j.id===invoice.work_order_id),'invoice_linked');return invoice;
  }
};
export const liveFieldMethods={
  async allRecords(table){
    const data=[];
    for(let start=0;;start+=500){const r=await this.client.from(table).select('*').order('created_at',{ascending:false}).order('id').range(start,start+499);if(r.error)return r;data.push(...r.data);if(r.data.length<500)return {data};}
  },
  async addUpdate(input,blob){
    const value=validateUpdate(input);validBlob(blob);
    const prior=await this.client.from('job_updates').select('*').eq('id',value.id).maybeSingle();problem(prior);if(prior.data)return prior.data;
    const path=blob?photoPath(value.work_order_id,this.user.id,value.id):null;
    const bucket=this.client.storage.from('royal-flush-job-photos');
    if(blob){
      const uploaded=await bucket.upload(path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
      if(uploaded.error){
        if(!['409','400'].includes(String(uploaded.error.statusCode)))throw new Error('Photo upload failed. Your update has not been posted.');
        // An uncertain earlier upload may have succeeded. Only reuse identical bytes.
        const existing=await bucket.download(path);
        if(existing.error||existing.data.size!==blob.size)throw new Error('Photo upload could not be verified. Reopen this job and try again.');
        const [a,b]=await Promise.all([existing.data.arrayBuffer(),blob.arrayBuffer()]);
        if(!new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]))throw new Error('The earlier photo differs. Reopen this job before trying another photo.');
      }
    }
    const result=await this.client.from('job_updates').insert({...value,photo_path:path,photo_bytes:blob?.size||null}).select().single();
    if(result.error){
      const retry=await this.client.from('job_updates').select('*').eq('id',value.id).maybeSingle();
      if(!retry.error&&retry.data)return retry.data;
      // Storage policies only permit deleting this uploader’s unreferenced objects.
      if(path)await bucket.remove([path]);
      throw new Error('The update was not confirmed. Check your connection and retry.');
    }
    return result.data;
  },
  async photo(id){
    const update=problem(await this.client.from('job_updates').select('photo_path').eq('id',id).maybeSingle());
    if(!update?.photo_path)throw new Error('Photo access is unavailable.');
    return problem(await this.client.storage.from('royal-flush-job-photos').download(update.photo_path));
  },
  async saveInvoice({id,work_order_id,line_items,version}){
    officeOnly(this);invoiceSubtotal(line_items);
    const query=version?this.client.from('invoices').update({line_items}).eq('id',id).eq('version',version):this.client.from('invoices').insert({id,work_order_id,line_items});
    const r=await query.select().maybeSingle();problem(r);if(!r.data)throw new Error('The invoice changed. Refresh before saving.');return r.data;
  },
  async linkInvoice(id,version,{provider_invoice_number,provider_url,provider_total_cents}){
    officeOnly(this);const url=quickBooksUrl(provider_url);
    if(!provider_invoice_number?.trim()||provider_invoice_number.length>80||!Number.isInteger(provider_total_cents)||provider_total_cents<1||provider_total_cents>100000000)throw new Error('Enter the approved invoice number and total from QuickBooks.');
    const r=await this.client.from('invoices').update({provider_invoice_number:provider_invoice_number.trim(),provider_url:url,provider_total_cents}).eq('id',id).eq('version',version).select().maybeSingle();
    problem(r);if(!r.data)throw new Error('The invoice changed. Refresh before linking.');return r.data;
  }
};
