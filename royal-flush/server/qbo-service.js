import {QboError,requireOffice,uuid,qboId,text,customerRecord,itemRecord,invoiceRecord,invoicePayload,digest,seal,unseal,verifyWebhook,webhookRealms} from './qbo-core.js';
const ok=result=>{if(result.error)throw new QboError('storage','The connection could not save its state. Retry after refreshing.',503);return result.data;};
const one=async query=>ok(await query.single());
const iso=()=>new Date().toISOString();
export function createQboService({db,auth,env,fetcher=fetch}){
  const origin=env.RF_APP_ORIGIN,realm=env.QBO_REALM_ID,environment=env.QBO_ENVIRONMENT;
  const apiBase=environment==='production'?'https://quickbooks.api.intuit.com':'https://sandbox-quickbooks.api.intuit.com';
  const redirect=env.SUPABASE_URL+'/functions/v1/royal-flush-qbo/callback';
  function configured(){
    if(!/^https:\/\/[^/]+$/.test(origin||'')||!['production','sandbox'].includes(environment)||!realm||!env.QBO_CLIENT_ID||!env.QBO_CLIENT_SECRET||!env.QBO_TOKEN_KEY)throw new QboError('not_configured','QuickBooks setup is not complete. No financial action was taken.',503);
    qboId(realm);
  }
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin||'null','Vary':'Origin','X-Content-Type-Options':'nosniff'}});
  async function memberFor(token){
    const result=await auth.getUser(token);if(result.error||!result.data?.user)throw new QboError('unauthorized','Please sign in again.',401);
    const member=ok(await db.from('members').select('user_id,role,active').eq('user_id',result.data.user.id).maybeSingle());
    requireOffice(member);return member;
  }
  async function memberAgain(member,write=false){const current=ok(await db.from('members').select('user_id,role,active').eq('user_id',member.user_id).maybeSingle());requireOffice(current,write);return current;}
  async function settings(){return one(db.from('settings').select('*').eq('id',true));}
  async function enabled(billing=false){const s=await settings();if(!s.quickbooks_enabled||!s.business_confirmed||!s.legal_reviewed||!s.security_reviewed||(billing&&!s.billing_enabled))throw new QboError('disabled','QuickBooks data access is not enabled for this workspace yet.',409);return s;}
  async function request(url,options={},signal){
    const response=await fetcher(url,{...options,redirect:'error',signal:signal||AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>null);
    if(!response.ok||!body||body.Fault){
      const error=new QboError(response.status===401?'reconnect':response.status===429?'rate_limit':'provider','QuickBooks could not complete the request. Refresh or reconnect before continuing.',response.status===429?429:502);error.providerStatus=response.status;throw error;
    }
    return body;
  }
  async function exchange(parameters){
    return request('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{method:'POST',headers:{Authorization:'Basic '+btoa(env.QBO_CLIENT_ID+':'+env.QBO_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(parameters).toString()});
  }
  async function storeTokens(tokens){
    if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<1)throw new QboError('token','QuickBooks authorization was incomplete.',502);
    const value={access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:Date.now()+tokens.expires_in*1000};
    ok(await db.from('qbo_secrets').update({realm_id:realm,tokens:await seal(value,env.QBO_TOKEN_KEY,realm),updated_at:iso()}).eq('id',true));return value;
  }
  async function token(){
    const state=await one(db.from('qbo_secrets').select('realm_id,tokens').eq('id',true));
    if(!state.tokens||state.realm_id!==realm)throw new QboError('not_connected','Connect the Royal Flush QuickBooks company first.',409);
    const token=await unseal(state.tokens,env.QBO_TOKEN_KEY,realm);
    return token.expires_at>Date.now()+60000?token:storeTokens(await exchange({grant_type:'refresh_token',refresh_token:token.refresh_token}));
  }
  async function locked(work){
    const lease=crypto.randomUUID();if(!ok(await db.rpc('qbo_acquire_lease',{p_id:lease})))throw new QboError('busy','Another QuickBooks update is running. Try again shortly.',409);
    const timeout=AbortSignal.timeout(75000);
    try{return await work(timeout);}finally{await db.rpc('qbo_release_lease',{p_id:lease});}
  }
  function client(token,signal){return async(path,{method='GET',body,query={}}={})=>{
    const url=new URL(apiBase+'/v3/company/'+qboId(realm)+'/'+path);for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
    return request(url.href,{method,headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},signal);
  };}
  async function snapshot(raw,link){
    const record=invoiceRecord(raw,link.customer_id);const contentHash=await digest(JSON.stringify({CustomerRef:raw.CustomerRef,CurrencyRef:raw.CurrencyRef,Line:raw.Line,TxnTaxDetail:raw.TxnTaxDetail,TotalAmt:raw.TotalAmt,DueDate:raw.DueDate}));
    const {id,...values}=record;
    const stage=link.stage==='approved'&&link.approved_content_hash===contentHash?'approved':'awaiting_review';
    return one(db.from('qbo_job_invoices').update({...values,provider_id:id,content_hash:contentHash,stage,synced_at:iso(),updated_at:iso()}).eq('id',link.id).select());
  }
  const getInvoice=(api,id)=>api('invoice/'+qboId(id),{query:{include:'invoiceLink'}}).then(r=>r.Invoice);
  async function sync(api){
    const state=await one(db.from('qbo_secrets').select('*').eq('id',true));
    let more=false;
    for(const [entity,table,position,convert,flag] of [['Customer','qbo_customers','customer_position',customerRecord,'customers_complete'],['Item','qbo_items','item_position',itemRecord,'items_complete']]){
      const start=state[position];
      const result=await api('query',{query:{query:'select * from '+entity+' where Active IN (true, false) STARTPOSITION '+start+' MAXRESULTS 100'}});
      const rows=result.QueryResponse?.[entity]||[];
      if(!Array.isArray(rows))throw new QboError('provider','QuickBooks returned an incomplete response.',502);
      const selected=rows.map(convert).map(row=>({...row,synced_at:iso()}));
      if(selected.length)ok(await db.from(table).upsert(selected));
      const complete=rows.length<100;more ||= !complete;
      ok(await db.from('qbo_secrets').update({[position]:complete?1:start+100}).eq('id',true));
      if(complete)ok(await db.from('qbo_connection').update({[flag]:true}).eq('id',true));
    }
    // Bounded rotation visits every linked invoice, including old invoices that can be reversed.
    const links=ok(await db.from('qbo_job_invoices').select('*').not('provider_id','is',null).order('id').range(state.invoice_position,state.invoice_position+9));
    for(const link of links){
      try{await snapshot(await getInvoice(api,link.provider_id),link);}catch(error){
        ok(await db.from('qbo_job_invoices').update({stage:'attention',payment_url:null,updated_at:iso()}).eq('id',link.id));throw error;
      }
    }
    ok(await db.from('qbo_secrets').update({invoice_position:links.length===10?state.invoice_position+10:0}).eq('id',true));
    ok(await db.from('qbo_connection').update({status:'connected',last_sync_at:iso(),last_error:null,updated_at:iso()}).eq('id',true));
    // Webhooks are hints, not payment facts. Reconciliation always rereads canonical invoices.
    if(links.length<10)ok(await db.from('qbo_webhooks').update({processed_at:iso()}).is('processed_at',null));
    return {ok:true,more,customers:undefined};
  }
  async function callback(url){
    configured();const state=url.searchParams.get('state');if(!state||state.length>200||url.searchParams.get('realmId')!==realm)throw new QboError('oauth','QuickBooks authorization did not match this company.',400);
    const claims=ok(await db.from('qbo_oauth_states').delete().eq('hash',await digest(state)).gt('expires_at',iso()).select());
    if(claims.length!==1)throw new QboError('oauth','This authorization has expired. Start again from the workspace.',400);
    const member=ok(await db.from('members').select('user_id,role,active').eq('user_id',claims[0].actor_id).maybeSingle());
    if(!member?.active||member.role!=='owner')throw new QboError('oauth','Owner access is required.',403);
    const code=url.searchParams.get('code');if(!code||code.length>2000)throw new QboError('oauth','QuickBooks authorization was cancelled.',400);
    await locked(async signal=>{
      const tokens=await exchange({grant_type:'authorization_code',code,redirect_uri:redirect});
      const company=await client(tokens,signal)('companyinfo/'+qboId(realm));
      if(!company.CompanyInfo?.CompanyName)throw new QboError('company','The QuickBooks company could not be verified.',409);
      await storeTokens(tokens);
      ok(await db.from('qbo_connection').update({status:'connected',company_name:text(company.CompanyInfo.CompanyName),environment,connected_at:iso(),last_error:null,updated_at:iso()}).eq('id',true));
    });
    return new Response('QuickBooks connected. Close this tab and refresh your Royal Flush workspace.',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"}});
  }
  async function hook(req){
    configured();const body=await req.text();if(body.length>262144||!await verifyWebhook(body,req.headers.get('intuit-signature'),env.QBO_WEBHOOK_VERIFIER))throw new QboError('signature','Invalid notification.',401);
    const payload=JSON.parse(body),realms=webhookRealms(payload);
    if(realms.includes(realm))ok(await db.from('qbo_webhooks').upsert({hash:await digest(body)},{onConflict:'hash',ignoreDuplicates:true}));
    return json({ok:true});
  }
  async function actions(action,body,member){
    if(action==='status')return {connection:ok(await db.from('qbo_connection').select('*').eq('id',true).single()),configured:!!(env.QBO_CLIENT_ID&&env.QBO_CLIENT_SECRET&&realm&&env.QBO_TOKEN_KEY)};
    configured();
    if(action==='connect'){
      if(member.role!=='owner')throw new QboError('forbidden','The owner must authorize the company connection.',403);
      const state=crypto.randomUUID()+crypto.randomUUID();ok(await db.from('qbo_oauth_states').delete().lt('expires_at',iso()));
      ok(await db.from('qbo_oauth_states').insert({hash:await digest(state),actor_id:member.user_id,expires_at:new Date(Date.now()+600000).toISOString()}));
      const url=new URL('https://appcenter.intuit.com/connect/oauth2');
      for(const [k,v] of Object.entries({client_id:env.QBO_CLIENT_ID,response_type:'code',scope:'com.intuit.quickbooks.accounting',redirect_uri:redirect,state}))url.searchParams.set(k,v);
      return {url:url.href};
    }
    await enabled(['create_invoice','link_invoice','approve_invoice'].includes(action));
    return locked(async signal=>{
      const api=client(await token(),signal);
      if(action==='sync'){await memberAgain(member);return sync(api);}
      if(action==='customer_invoices'){
        const customer=qboId(body.customer_id);const result=await api('query',{query:{query:"select * from Invoice where CustomerRef = '"+customer+"' ORDERBY TxnDate DESC MAXRESULTS 30",include:'invoiceLink'}});
        return {invoices:(result.QueryResponse?.Invoice||[]).map(i=>invoiceRecord(i,customer))};
      }
      requireOffice(member,true);await memberAgain(member,true);
      if(action==='create_invoice'){
        if(body.confirmed!==true)throw new QboError('approval','Debra must review the customer, line items and tax treatment.');
        const draft=await one(db.from('invoices').select('*').eq('id',uuid(body.draft_id)));
        if(draft.version!==body.version||draft.stage!=='draft')throw new QboError('changed','The draft changed. Refresh before approval.',409);
        if(!Array.isArray(body.item_ids)||!Array.isArray(body.tax_codes)||body.item_ids.length!==draft.line_items.length)throw new QboError('items','Match every draft line to a QuickBooks service.');
        const customer=customerRecord((await api('customer/'+qboId(body.customer_id))).Customer);
        const items=[];for(const id of body.item_ids)items.push(itemRecord((await api('item/'+qboId(id))).Item));
        const s=await enabled(true);
        const payload=invoicePayload(draft,customer,items,body.tax_codes,{card:s.payments_enabled&&env.QBO_ALLOW_CARD==='true',ach:s.payments_enabled&&env.QBO_ALLOW_ACH==='true'});
        ok(await db.from('qbo_customers').upsert({...customer,synced_at:iso()}));
        const requestId=crypto.randomUUID();
        const jobInvoiceId=ok(await db.rpc('qbo_reserve_invoice',{p_actor:member.user_id,p_draft:draft.id,p_version:body.version,p_customer:customer.id,p_payload:payload,p_id:requestId}));
        try{
          await memberAgain(member,true);await enabled(true);
          ok(await db.from('qbo_requests').update({state:'sending',updated_at:iso()}).eq('id',requestId).eq('state','reserved'));
          const result=await api('invoice',{method:'POST',body:payload,query:{requestid:requestId}});
          const link=await one(db.from('qbo_job_invoices').select('*').eq('id',jobInvoiceId));
          const invoice=await snapshot(result.Invoice,link);
          ok(await db.from('qbo_requests').update({state:'succeeded',updated_at:iso()}).eq('id',requestId));
          return {invoice,message:'Created in QuickBooks. Review its final total before releasing it to the technician. No email was sent.'};
        }catch(error){
          await db.from('qbo_requests').update({state:'uncertain',updated_at:iso()}).eq('id',requestId);
          await db.from('qbo_job_invoices').update({stage:'attention',updated_at:iso()}).eq('id',jobInvoiceId);
          throw new QboError('uncertain','The invoice result needs review in QuickBooks. Do not create another invoice. Link the existing invoice after checking it.',409);
        }
      }
      if(action==='link_invoice'){
        if(body.confirmed!==true)throw new QboError('approval','Confirm that this invoice belongs to the selected job.');
        const job=await one(db.from('work_orders').select('id').eq('id',uuid(body.work_order_id)));
        const customerId=qboId(body.customer_id),raw=await getInvoice(api,body.invoice_id);invoiceRecord(raw,customerId);
        const customer=customerRecord((await api('customer/'+customerId)).Customer);ok(await db.from('qbo_customers').upsert({...customer,synced_at:iso()}));
        let link=ok(await db.from('qbo_job_invoices').select('*').eq('work_order_id',job.id).maybeSingle());
        if(link&&(link.customer_id!==customerId||link.provider_id&&link.provider_id!==String(raw.Id)))throw new QboError('conflict','This job already has a different QuickBooks invoice.',409);
        if(!link)link=await one(db.from('qbo_job_invoices').insert({work_order_id:job.id,customer_id:customerId}).select());
        return {invoice:await snapshot(raw,link)};
      }
      if(action==='approve_invoice'){
        if(body.confirmed!==true)throw new QboError('approval','Confirm the final invoice before releasing it.');
        let link=await one(db.from('qbo_job_invoices').select('*').eq('id',uuid(body.id)));
        if(!link.provider_id)throw new QboError('missing','Resolve this invoice in QuickBooks first.',409);
        const current=await snapshot(await getInvoice(api,link.provider_id),link);
        if(current.sync_token!==body.sync_token||current.total_cents!==body.total_cents)throw new QboError('changed','QuickBooks changed the invoice. Review its updated total before releasing it.',409);
        await memberAgain(member,true);await enabled(true);
        const approved=await one(db.from('qbo_job_invoices').update({stage:'approved',approved_by:member.user_id,approved_at:iso(),approved_total_cents:current.total_cents,approved_sync_token:current.sync_token,approved_content_hash:current.content_hash}).eq('id',current.id).select());
        return {invoice:approved};
      }
      throw new QboError('action','Unsupported action.');
    });
  }
  return async req=>{
    try{
      const url=new URL(req.url),route=url.pathname.split('/').pop();
      if(route==='callback'&&req.method==='GET')return await callback(url);
      if(route==='webhook'&&req.method==='POST')return await hook(req);
      if(route==='reconcile'&&req.method==='POST'){
        configured();const supplied=req.headers.get('authorization')||'';
        if(!env.RF_QBO_CRON_SECRET||await digest(supplied)!==await digest('Bearer '+env.RF_QBO_CRON_SECRET))throw new QboError('unauthorized','Scheduled connection access required.',401);
        await enabled();return json(await locked(async signal=>sync(client(await token(),signal))));
      }
      if(req.method==='OPTIONS'&&req.headers.get('origin')===origin)return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST','Vary':'Origin'}});
      if(req.method!=='POST'||req.headers.get('origin')!==origin)throw new QboError('origin','Request not allowed.',403);
      const member=await memberFor((req.headers.get('authorization')||'').replace(/^Bearer /i,''));
      const raw=await req.text();if(raw.length>30000)throw new QboError('large','Request is too large.',413);
      const body=JSON.parse(raw);if(!body||typeof body.action!=='string')throw new QboError('action','Choose an action.');
      return json(await actions(body.action,body,member));
    }catch(error){
      const known=error instanceof QboError;
      // Never log provider payloads, OAuth codes, customer data or tokens.
      return json({error:known?error.code:'unavailable',message:known?error.message:'The QuickBooks connection is unavailable. No automatic retry was made.'},known?error.status:503);
    }
  };
}
