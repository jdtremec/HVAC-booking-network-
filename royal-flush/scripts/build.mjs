import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const mode=process.env.RF_MODE||'preview';
if(!['preview','live'].includes(mode))throw new Error('RF_MODE must be preview or live');
const config=mode==='live'?{url:process.env.RF_SUPABASE_URL||'',key:process.env.RF_SUPABASE_PUBLISHABLE_KEY||''}:null;
if(mode==='live'&&(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url)||config.url.includes('stsmdfxcekkxpngkfrmz')||!config.key.startsWith('sb_publishable_')))throw new Error('Live builds require a dedicated project URL and publishable key.');
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,minify:true,format:'esm',outfile:'dist/app.js',define:{__RF_CONFIG__:JSON.stringify(config)},target:['es2022']});
await copyFile('index.html','dist/index.html');await copyFile('src/styles.css','dist/styles.css');
await writeFile('dist/_headers','/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: no-store\n');
console.log('Built Royal Flush '+mode+' package in dist/.');

