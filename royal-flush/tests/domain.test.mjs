import test from 'node:test';
import assert from 'node:assert/strict';
import {centralToUTC,centralInput,validateTransition,validateRequest,overlaps,escapeHtml} from '../src/domain.js';
test('Central Time handles summer, winter and invalid daylight-saving hours',()=>{
  assert.equal(centralToUTC('2026-07-15T08:00'),'2026-07-15T13:00:00.000Z');
  assert.equal(centralToUTC('2026-11-03T08:00'),'2026-11-03T14:00:00.000Z');
  assert.throws(()=>centralToUTC('2026-03-08T02:30'),/missing or repeated/);
  assert.throws(()=>centralToUTC('2026-11-01T01:30'),/missing or repeated/);
  assert.throws(()=>centralToUTC('2026-02-30T10:00'));
  assert.equal(centralInput(new Date('2026-11-04T00:00Z')),'2026-11-03T18:00');
});
test('role and status checks reject skipping and foreign assignments',()=>{
  const job={status:'assigned',assigned_to:'a'};
  assert.doesNotThrow(()=>validateTransition(job,'en_route','technician','a'));
  assert.throws(()=>validateTransition(job,'en_route','technician','b'));
  assert.throws(()=>validateTransition(job,'completed','dispatcher','b'));
  assert.throws(()=>validateTransition(job,'en_route','customer','a'));
});
test('schedule windows allow adjacency, reject overlap and ignore completed jobs',()=>{
  const job={id:'one',assigned_to:'a',status:'assigned',scheduled_start:'2026-11-03T14:00Z',scheduled_end:'2026-11-03T15:00Z'};
  assert.equal(overlaps([job],{...job,id:'two'}),true);
  assert.equal(overlaps([job],{...job,id:'two',scheduled_start:job.scheduled_end,scheduled_end:'2026-11-03T16:00Z'}),false);
  assert.equal(overlaps([{...job,status:'completed'}],{...job,id:'two'}),false);
});
test('HTML is escaped and intake validates the service notice',()=>{
  assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
  assert.throws(()=>validateRequest({issue:'HVAC'}));
  const data={issue:'Water heater',customer_name:'Sample',customer_phone:'202-555-0100',street_address:'Fictional',city:'Panama City',zip_code:'32401',priority:'normal',terms_version:'rf-draft-2026-11-03'};
  assert.equal(validateRequest(data),data);
  assert.throws(()=>validateRequest({...data,terms_version:''}),/notice/);
});

