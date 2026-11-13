import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'madar-deploy-fixture-'));after(()=>rmSync(root,{recursive:true,force:true}));
function run(cmd,args,cwd,env=process.env){const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:20000});if(r.status!==0)throw Error(`${cmd}: ${r.stderr}`);return r.stdout.trim();}
function fixture(name){
 const base=join(root,name),repo=join(base,'repo'),remote=join(base,'remote.git'),bin=join(base,'bin');mkdirSync(repo,{recursive:true});mkdirSync(bin);
 run('git',['init','--bare','--initial-branch=main',remote],base);run('git',['init','--initial-branch=main'],repo);
 run('git',['config','user.email','fixture@example.invalid'],repo);run('git',['config','user.name','Isolated fixture'],repo);
 mkdirSync(join(repo,'madar-v2/scripts'),{recursive:true});mkdirSync(join(repo,'madar-v2/client/src'),{recursive:true});
 cpSync(new URL('../scripts/auto-pull.sh',import.meta.url),join(repo,'madar-v2/scripts/auto-pull.sh'));
 writeFileSync(join(repo,'.gitignore'),'madar-v2/logs/\nmadar-v2/client/dist*/\n');writeFileSync(join(repo,'madar-v2/client/src/app.js'),'fixture');
 run('git',['add','.'],repo);run('git',['commit','-qm','fixture'],repo);run('git',['remote','add','origin',remote],repo);run('git',['push','-qu','origin','main'],repo);
 const callLog=join(base,'calls');
 writeFileSync(join(bin,'npm'),'#!/bin/sh\necho "npm $*" >> "$CALL_LOG"\n[ "$1" != test ] || [ "${FAIL_TESTS:-0}" != 1 ] || exit 1\nif [ "$1" = run ]; then mkdir -p dist-next; echo candidate > dist-next/index.html; fi\n',{mode:0o755});
 writeFileSync(join(bin,'pm2'),'#!/bin/sh\necho "pm2 $*" >> "$CALL_LOG"\n',{mode:0o755});
 writeFileSync(join(bin,'node'),'#!/bin/sh\necho "node $*" >> "$CALL_LOG"\n[ "${FAIL_HEALTH:-0}" != 1 ]\n',{mode:0o755});
 const env={...process.env,PATH:bin+':'+process.env.PATH,CALL_LOG:callLog};
 return {repo,base,callLog,env,run(extra={}){return spawnSync('bash',['madar-v2/scripts/auto-pull.sh'],{cwd:repo,env:{...env,...extra},timeout:20000});}};
}
test('equal main/origin still deploys when receipt is missing; only verified deployment advances receipt',()=>{
 const f=fixture('equal');const sha=run('git',['rev-parse','HEAD'],f.repo);
 assert.equal(f.run().status,0);assert.equal(readFileSync(join(f.repo,'madar-v2/logs/.auto-pull/deployed-revision'),'utf8').trim(),sha);
 const calls=readFileSync(f.callLog,'utf8');assert.match(calls,/npm test/);assert.match(calls,/pm2 restart/);assert.match(calls,/verify-deployment/);
 assert.equal(f.run().status,0);assert.equal(readFileSync(f.callLog,'utf8'),calls,'verified unchanged revision is not restarted');
});
test('failing tests block restart, and failed health restores previous web without a false receipt',()=>{
 const f=fixture('fail');assert.equal(f.run({FAIL_TESTS:'1'}).status,1);
 assert.doesNotMatch(readFileSync(f.callLog,'utf8'),/pm2/);assert.equal(existsSync(join(f.repo,'madar-v2/logs/.auto-pull/deployed-revision')),false);
 mkdirSync(join(f.repo,'madar-v2/client/dist'),{recursive:true});writeFileSync(join(f.repo,'madar-v2/client/dist/index.html'),'previous');
 assert.equal(f.run({FAIL_HEALTH:'1'}).status,1);assert.equal(readFileSync(join(f.repo,'madar-v2/client/dist/index.html'),'utf8'),'previous');
 assert.equal(existsSync(join(f.repo,'madar-v2/logs/.auto-pull/deployed-revision')),false);
});
test('dirty source is preserved and is never deployed',()=>{
 const f=fixture('dirty');writeFileSync(join(f.repo,'madar-v2/client/src/app.js'),'uncommitted owner work');
 assert.equal(f.run().status,0);assert.equal(existsSync(f.callLog),false);assert.equal(readFileSync(join(f.repo,'madar-v2/client/src/app.js'),'utf8'),'uncommitted owner work');
});
test('an unpushed local commit is preserved and never deployed as the remote revision',()=>{
 const f=fixture('ahead');writeFileSync(join(f.repo,'madar-v2/client/src/app.js'),'local committed work');
 run('git',['add','.'],f.repo);run('git',['commit','-qm','local-only'],f.repo);
 assert.equal(f.run().status,0);assert.equal(existsSync(f.callLog),false);
 assert.equal(readFileSync(join(f.repo,'madar-v2/client/src/app.js'),'utf8'),'local committed work');
});
