// Fallback for this execution image, which does not contain the Sites workflow helper.
// Reads the native Sites repository credential from hidden stdin; never persists it.
import {spawnSync,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
if(process.stdin.isTTY)spawnSync('stty',['-echo'],{stdio:'inherit'});
console.log('Ready for Site repository credential on stdin (input is hidden).');
const rl=createInterface({input:process.stdin,terminal:false});
const [line]=await new Promise(resolve=>rl.once('line',s=>resolve([s])));rl.close();
if(process.stdin.isTTY)spawnSync('stty',['echo'],{stdio:'inherit'});
const c=JSON.parse(line);
function run(cmd,args,env={}){const r=spawnSync(cmd,args,{encoding:'utf8',env:{...process.env,...env}});if(r.status!==0){console.error((r.stderr||r.stdout||'Command failed').replaceAll(c.token||'__NO_TOKEN__','[redacted]'));process.exit(1);}return r.stdout.trim();}
run('git',['init','-b',c.branch||'main']);
run('git',['config','user.name','Codex']);run('git',['config','user.email','codex@users.noreply.local']);
const remotes=run('git',['remote']);if(!remotes.split('\n').includes('origin'))run('git',['remote','add','origin',c.remote_url]);
run('git',['add','.']);const dirty=run('git',['status','--porcelain']);if(dirty)run('git',['commit','-m','Build Around Me public activity observatory']);
const header=c.auth_mode==='work_proxy'?null:(c.token.toLowerCase().startsWith('authorization:')?c.token:`Authorization: Bearer ${c.token}`);
const env=header?{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:header}:{};
run('git',['push','-u','origin',`HEAD:${c.branch||'main'}`],env);
const commit=run('git',['rev-parse','HEAD']);
run('tar',['-czf','/tmp/around-me-deployment.tar.gz','.openai/hosting.json','dist/server']);
console.log(JSON.stringify({project_id:'appgprj_6af46681f92c8191b47a865e9e450513',commit_sha:commit,archive:'/tmp/around-me-deployment.tar.gz'}));
