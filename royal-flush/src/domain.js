export const COMPANY = {
  name: 'Royal Flush Plumbing of the Florida Panhandle, Inc.',
  shortName: 'Royal Flush', phone: '850-276-9300', license: 'CFC1426449',
  timezone: 'America/Chicago',
  areas: ['Panama City Beach', 'Panama City', '30A corridor', 'Nearby / office review'],
};
export const STATUSES = ['requested', 'assigned', 'en_route', 'working', 'completed', 'cancelled'];
export const LABELS = { requested: 'Requested', assigned: 'Assigned', en_route: 'En route', working: 'Working', completed: 'Completed', cancelled: 'Cancelled' };
export const ISSUES = ['Leak or burst pipe', 'Clogged drain', 'Water heater', 'Fixture repair', 'Other plumbing'];
export const NEXT = { requested: ['assigned','cancelled'], assigned: ['en_route','cancelled'], en_route: ['working','cancelled'], working: ['completed','cancelled'], completed: [], cancelled: [] };
export const isOffice = role => ['owner','dispatcher'].includes(role);
export const active = job => !['completed','cancelled'].includes(job.status);
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function centralInput(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: COMPANY.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
}
export function centralToUTC(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid Central Time appointment.');
  const base = Date.parse(value+'Z');
  const matches = [5,6].map(offset=>new Date(base+offset*3600000)).filter(d=>Number.isFinite(d.getTime())&&centralInput(d)===value);
  if(matches.length!==1) throw new Error('That Central Time is missing or repeated during the daylight-saving change. Choose another time.');
  return matches[0].toISOString();
}
export function formatTime(value) {
  return value ? new Intl.DateTimeFormat('en-US',{timeZone:COMPANY.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)) : 'Office to confirm';
}
export function validateRequest(data) {
  if(!ISSUES.includes(data.issue)) throw new Error('Choose a plumbing service.');
  for(const [key,max] of [['customer_name',100],['customer_phone',30],['street_address',200],['city',100]]) {
    if(!String(data[key]||'').trim() || data[key].length>max) throw new Error('Complete the customer and service address fields.');
  }
  if(!/^[0-9+() .-]{7,30}$/.test(data.customer_phone)) throw new Error('Enter a valid contact phone.');
  if(!/^\d{5}$/.test(data.zip_code)) throw new Error('Enter a five-digit ZIP code.');
  if(!['normal','urgent'].includes(data.priority)) throw new Error('Choose a priority.');
  if((data.notes||'').length>1000) throw new Error('Keep the service notes under 1,000 characters.');
  if(data.terms_version!=='rf-draft-2026-11-03') throw new Error('Acknowledge the service request notice.');
  return data;
}
export function validateTransition(job, status, role, userId) {
  if(!NEXT[job.status]?.includes(status)) throw new Error('That status change is not available. Refresh the job.');
  if(!isOffice(role) && !(role==='technician' && job.assigned_to===userId && ['en_route','working','completed'].includes(status))) throw new Error('This action needs office access or the assigned technician.');
  if(status==='assigned' && !job.assigned_to) throw new Error('Assign a technician first.');
}
export function overlaps(jobs, candidate) {
  return jobs.some(j=>j.id!==candidate.id && active(j) && j.assigned_to===candidate.assigned_to && j.scheduled_start && candidate.scheduled_start < j.scheduled_end && candidate.scheduled_end > j.scheduled_start);
}

