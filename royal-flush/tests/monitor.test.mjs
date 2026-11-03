import test from 'node:test';
import assert from 'node:assert/strict';
import {startMonitor,monitorLabel} from '../src/monitor.js';
import {DemoRepository,SupabaseRepository} from '../src/repository.js';
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(load){
  let tick,change,status,removed=0,cleared=0,revoked=0;
  const data=[],states=[],target=new EventTarget(),visibility=new EventTarget();
  visibility.visibilityState='visible';
  const controller=startMonitor({load,onData:d=>data.push(d),onState:s=>states.push(s),
    onAccessRemoved:()=>revoked++,target,visibility,now:()=>1000,
    timers:{setInterval(fn,ms){assert.equal(ms,15000);tick=fn;return 7;},clearInterval(id){assert.equal(id,7);cleared++;}},
    subscribe(c,s){change=c;status=s;return()=>removed++;}
  });
  return {controller,data,states,target,visibility,tick:()=>tick(),change:()=>change(),status:s=>status(s),
    counts:()=>({removed,cleared,revoked})};
}
test('owner monitor receives changes, falls back to polling and refreshes on return',async()=>{
  let version=1;
  const f=fixture(async()=>({version}));await settle();
  assert.equal(f.data.at(-1).version,1);
  f.status('SUBSCRIBED');await settle();assert.equal(f.states.at(-1).connected,true);
  version=2;f.change();await settle();assert.equal(f.data.at(-1).version,2);
  f.status('CHANNEL_ERROR');version=3;f.tick();await settle();
  assert.equal(f.data.at(-1).version,3);assert.equal(f.states.at(-1).connected,false);
  f.target.dispatchEvent(new Event('offline'));assert.match(f.states.at(-1).failure,/Offline/);
  version=4;f.target.dispatchEvent(new Event('online'));await settle();assert.equal(f.data.at(-1).version,4);
  version=5;f.visibility.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(f.data.at(-1).version,5);
  f.controller.stop();f.controller.stop();assert.deepEqual(f.counts(),{removed:1,cleared:1,revoked:0});
  const count=f.data.length;f.tick();f.change();f.target.dispatchEvent(new Event('focus'));await settle();assert.equal(f.data.length,count);
});
test('changes arriving during a read are reconciled; stopped reads cannot restore private data',async()=>{
  let resolve,calls=0;
  const f=fixture(()=>{calls++;return new Promise(r=>resolve=r);});
  f.change();f.change();assert.equal(calls,1);
  resolve({version:1});await settle();assert.equal(calls,2);
  resolve({version:2});await settle();assert.equal(f.data.at(-1).version,2);
  f.change();f.controller.stop();resolve({version:3});await settle();assert.equal(f.data.at(-1).version,2);
});
test('failed reads retain a visibly stale snapshot; revoked access clears through callback',async()=>{
  let mode='ok';
  const f=fixture(async()=>{if(mode==='offline')throw new Error('Network unavailable');if(mode==='revoked')throw Object.assign(new Error('No access'),{accessRemoved:true});return {version:1};});
  await settle();mode='offline';f.tick();await settle();
  assert.equal(f.data.length,1);assert.match(monitorLabel(f.states.at(-1),2000),/Updates interrupted/);
  mode='revoked';f.tick();await settle();assert.deepEqual(f.counts(),{removed:1,cleared:1,revoked:1});
});
test('connection wording never describes old or failed reads as current',()=>{
  assert.match(monitorLabel({lastSuccess:null,failure:'offline'},1000),/unavailable/);
  assert.match(monitorLabel({lastSuccess:1000,connected:true},2000),/Live updates connected/);
  assert.match(monitorLabel({lastSuccess:1000,connected:true},61000),/delayed/);
  assert.match(monitorLabel({lastSuccess:1000,connected:false},2000),/15 seconds/);
});
test('owner preview reads every job but cannot create or update; dispatcher retains control',async()=>{
  const repo=new DemoRepository();repo.setRole('owner');
  assert.equal((await repo.load()).jobs.length,3);
  await assert.rejects(repo.create({}),/Office access/);
  const job=repo.jobs[0];await assert.rejects(repo.update(job.id,job.version,{status:'cancelled'}),/read-only/);
  repo.setRole('dispatcher');await repo.update(job.id,job.version,{status:'cancelled'});
  repo.setRole('owner');assert.equal((await repo.load()).jobs[0].status,'cancelled');
});
test('live subscriptions use only company tables, INSERT/UPDATE and removable channels',()=>{
  const repo=Object.create(SupabaseRepository.prototype),filters=[];
  let removed=null,subscribed=null;
  const channel={on(type,filter,fn){assert.equal(type,'postgres_changes');filters.push(filter);return this;},subscribe(fn){subscribed=fn;return this;}};
  repo.user={id:'owner'};repo.client={channel(name){assert.equal(name,'royal-flush-owner-owner');return channel;},removeChannel(c){removed=c;return Promise.resolve('ok');}};
  const change=()=>{},status=()=>{},stop=repo.watch(change,status);
  assert.equal(subscribed,status);assert.equal(filters.length,8);
  assert.ok(filters.every(f=>f.schema==='royal_flush'&&['INSERT','UPDATE'].includes(f.event)));
  stop();assert.equal(removed,channel);
});
test('job loading includes later pages instead of silently dropping older active work',async()=>{
  const repo=Object.create(SupabaseRepository.prototype),calls=[];
  repo.client={from(table){
    assert.equal(table,'work_orders');
    return {
      select(){return this;},order(){return this;},
      async range(start,end){calls.push([start,end]);return {data:Array.from({length:start===0?500:3},(_,i)=>({id:start+i}))};}
    };
  }};
  const result=await repo.allJobs();assert.equal(result.data.length,503);assert.deepEqual(calls,[[0,499],[500,999]]);
});
