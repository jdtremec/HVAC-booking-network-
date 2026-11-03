import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createQboService} from './qbo-service.js';
const env=Deno.env.toObject();
if(!env.SUPABASE_URL||env.SUPABASE_URL.includes('stsmdfxcekkxpngkfrmz'))throw new Error('Dedicated Royal Flush project required');
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{db:{schema:'royal_flush'},auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createQboService({db:client,auth:client.auth,env}));
