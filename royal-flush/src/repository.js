import {createClient} from '@supabase/supabase-js';
import {isOffice,validateRequest,validateTransition,overlaps,centralInput,centralToUTC} from './domain.js';

const ids={office:'00000000-0000-4000-8000-000000000001',tech:'00000000-0000-4000-8000-000000000002',tech2:'00000000-0000-4000-8000-000000000003',customer:'00000000-0000-4000-8000-000000000004'};
export class DemoRepository {
  constructor() {
    this.demo=true; this.setRole('dispatcher'); this.settings={intake_enabled:false};
    this.members=[{user_id:ids.office,display_name:'Demo dispatcher',role:'dispatcher',active:true},{user_id:ids.tech,display_name:'Demo technician A',role:'technician',active:true},{user_id:ids.tech2,display_name:'Demo technician B',role:'technician',active:true}];
    const day=centralInput().slice(0,10);
    this.jobs=[
      {id:crypto.randomUUID(),issue:'Leak or burst pipe',city:'Panama City Beach',zip_code:'32407',priority:'urgent',status:'requested',assigned_to:null,scheduled_start:null,scheduled_end:null},
      {id:crypto.randomUUID(),issue:'Water heater',city:'Panama City',zip_code:'32401',priority:'normal',status:'assigned',assigned_to:ids.tech,scheduled_start:centralToUTC(day+'T10:00'),scheduled_end:centralToUTC(day+'T11:00')},
      {id:crypto.randomUUID(),issue:'Clogged drain',city:'30A corridor',zip_code:'32459',priority:'normal',status:'working',assigned_to:ids.tech2,scheduled_start:centralToUTC(day+'T08:00'),scheduled_end:centralToUTC(day+'T09:00')},
    ].map((j,i)=>({...j,customer_id:ids.customer,customer_name:'Sample customer '+(i+1),customer_phone:'202-555-01'+(10+i),street_address:'Fictional service address '+(i+1),notes:'Fictional training job. No service requested.',version:1,created_at:new Date().toISOString(),terms_version:'rf-draft-2026-11-03'}));
    this.events=[]; this.outbox=[];
  }
  setRole(role) {this.user={id:role==='technician'?ids.tech:role==='customer'?ids.customer:ids.office};this.profile={role,display_name:role==='technician'?'Demo technician A':role==='customer'?'Sample customer':'Demo dispatcher'};}
  async load() {
    const jobs=this.jobs.filter(j=>isOffice(this.profile.role)||j.assigned_to===this.user.id||this.profile.role==='customer'&&j.customer_id===this.user.id);
    return {jobs:structuredClone(jobs),members:this.members.filter(m=>isOffice(this.profile.role)||m.user_id===this.user.id),events:this.events.filter(e=>jobs.some(j=>j.id===e.work_order_id)),outbox:isOffice(this.profile.role)?this.outbox:[],settings:this.settings};
  }
  record(job,type) {
    const event={id:crypto.randomUUID(),work_order_id:job.id,event_type:type,status:job.status,created_at:new Date().toISOString()};
    this.events.unshift(event);this.outbox.unshift({id:crypto.randomUUID(),event_id:event.id,work_order_id:job.id,event_type:type,delivery_state:'disabled',created_at:event.created_at});
  }
  async create(data) {
    if(!['customer','owner','dispatcher'].includes(this.profile.role)) throw new Error('Office access is required.');
    validateRequest(data);
    const existing=this.jobs.find(j=>j.id===data.id);if(existing)return existing;
    const job={...data,customer_id:ids.customer,status:'requested',assigned_to:null,scheduled_start:null,scheduled_end:null,version:1,created_at:new Date().toISOString()};
    this.jobs.unshift(job);this.record(job,'requested');return job;
  }
  async update(id,version,patch) {
    const job=this.jobs.find(j=>j.id===id);if(!job||job.version!==version)throw new Error('This job changed. Refresh before saving.');
    const next={...job,...patch};
    if('assigned_to' in patch) {
      if(!isOffice(this.profile.role))throw new Error('Only the office can assign technicians.');
      if(!['requested','assigned'].includes(job.status))throw new Error('This job has already started.');
      if(!this.members.some(m=>m.user_id===next.assigned_to&&m.role==='technician'&&m.active))throw new Error('Choose an active Royal Flush technician.');
      if(!next.scheduled_start||next.scheduled_end<=next.scheduled_start)throw new Error('Choose a valid appointment window.');
      if(overlaps(this.jobs,next))throw new Error('That technician already has a job in this time window.');
    }
    if(next.status!==job.status)validateTransition(next.status==='assigned'?{...job,assigned_to:next.assigned_to}:job,next.status,this.profile.role,this.user.id);
    Object.assign(job,next,{version:version+1});this.record(job,'assigned_to' in patch?'scheduled':job.status);return job;
  }
}
export class SupabaseRepository {
  constructor(config) {
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url)||config.url.includes('stsmdfxcekkxpngkfrmz')||!config.key.startsWith('sb_publishable_')) throw new Error('A dedicated Royal Flush project and publishable key are required.');
    this.demo=false;this.client=createClient(config.url,config.key,{db:{schema:'royal_flush'},auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
  }
  async login(email,password) {
    const {data,error}=await this.client.auth.signInWithPassword({email,password});if(error)throw new Error('Sign-in failed. Check your credentials or contact the office.');
    this.user=data.user;
    const r=await this.client.from('members').select('user_id,role,display_name,active').eq('user_id',this.user.id).eq('active',true).maybeSingle();
    if(r.error||!r.data){await this.logout();throw new Error('Your account does not have Royal Flush access.');}
    this.profile=r.data;
  }
  async logout(){await this.client.auth.signOut();this.user=null;this.profile=null;}
  async load(){
    const results=await Promise.all([
      this.client.from('work_orders').select('*').order('created_at',{ascending:false}).limit(200),
      this.client.from('members').select('user_id,display_name,role,active').eq('active',true),
      this.client.from('work_order_events').select('*').order('created_at',{ascending:false}).limit(200),
      isOffice(this.profile.role)?this.client.from('notification_outbox').select('*').order('created_at',{ascending:false}).limit(50):Promise.resolve({data:[]}),
      this.client.from('settings').select('intake_enabled').eq('id',true).single()
    ]);
    if(results.some(r=>r.error))throw new Error('Unable to load Royal Flush records. Check your connection and access, then retry.');
    const [jobs,members,events,outbox,settings]=results.map(r=>r.data);return {jobs,members,events,outbox,settings};
  }
  async create(data){
    validateRequest(data);
    const {data:job,error}=await this.client.from('work_orders').insert({...data,customer_id:this.profile.role==='customer'?this.user.id:null}).select().single();
    if(error?.code==='23505'){const prior=await this.client.from('work_orders').select('*').eq('id',data.id).single();if(!prior.error)return prior.data;}
    if(error)throw new Error(error.message);return job;
  }
  async update(id,version,patch){
    const r=await this.client.from('work_orders').update(patch).eq('id',id).eq('version',version).select().maybeSingle();
    if(r.error)throw new Error(r.error.message);if(!r.data)throw new Error('This job changed or access was removed. Refresh before saving.');return r.data;
  }
}

