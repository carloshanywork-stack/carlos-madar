// Read source syntax only. Does not import application modules or read runtime secrets.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const parser = require(require.resolve('@babel/parser', { paths: [path.join(root, 'madar-v2/client')] }));
const traverse = require(require.resolve('@babel/traverse', { paths: [path.join(root, 'madar-v2/client')] })).default;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const parse = p => parser.parse(read(p), { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], errorRecovery: false });
const str = n => !n ? null : n.type === 'StringLiteral' ? n.value
  : n.type === 'TemplateLiteral' ? n.quasis.map(q => q.value.cooked).join('{dynamic}')
  : n.type === 'BinaryExpression' && n.operator === '+' ? (str(n.left) ?? '{dynamic}') + (str(n.right) ?? '{dynamic}') : null;
const member = n => n?.type === 'MemberExpression' ? { object: n.object.name, method: n.property.name } : {};
const evidence = (file, n) => ({ file, line: n.loc.start.line });
const appFile = 'madar-v2/server/app.js', app = parse(appFile), imports = {}, mounts = [];
traverse(app, { ImportDeclaration(p) { for (const s of p.node.specifiers) imports[s.local.name] = path.posix.normalize(path.posix.join('madar-v2/server', p.node.source.value)); }, CallExpression(p) {
  const c = p.node, m = member(c.callee);
  if (m.object === 'app' && m.method === 'use') {
    const prefix = str(c.arguments[0]);
    for (const a of c.arguments.slice(1)) if (prefix && imports[a.name]) mounts.push({ prefix, file: imports[a.name], mount: evidence(appFile,c) });
  }
} });
const routes = [];
function collectRoutes(file, prefix) {
 traverse(parse(file), { CallExpression(p) {
  const c=p.node,m=member(c.callee);
  if (!['router','app'].includes(m.object) || !['get','post','put','patch','delete','head','options'].includes(m.method)) return;
  const args=c.arguments[0]?.type==='ArrayExpression'?c.arguments[0].elements:[c.arguments[0]];
  for(const arg of args){const local=str(arg);if(!local)continue;routes.push({method:m.method.toUpperCase(),path:(prefix+local).replace(/\/$/,'')||'/',...evidence(file,c),mount:mounts.find(v=>v.file===file)?.mount||null,middleware:c.arguments.slice(1).filter(a=>a.type==='Identifier'||a.type==='CallExpression').map(a=>a.name||a.callee?.name).filter(Boolean)});}
 } });
}
collectRoutes(appFile,'');for(const m of mounts)collectRoutes(m.file,m.prefix);
const tracked=cp.execFileSync('git',['ls-files','madar-v2/client/src','madar-v2/android/app/src/main/java','madar-v2/server','madar-v2/test'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const calls=[],events=[],tests=[],nativeCalls=[];
for(const file of tracked){
 if(file.endsWith('.java')){for(const [i,line] of read(file).split('\n').entries())for(const match of line.matchAll(/"(\/api\/[^"\s]*)"/g))nativeCalls.push({path:match[1],file,line:i+1,method:'DYNAMIC_NATIVE_CALL'});continue;}
 if(!/\.(js|jsx|ts|tsx)$/.test(file))continue;
 traverse(parse(file), { CallExpression(p){
  const c=p.node,m=member(c.callee),first=str(c.arguments[0]);
  if(file.includes('/client/')&&((m.object==='api'&&['get','post','put','patch','delete','upload'].includes(m.method))||c.callee.name==='fetch'||c.callee.name==='apiUrl')){
   const candidate=first||str(c.arguments[0]?.arguments?.[0]);
   if(candidate&&/^(\/api\/|\/download\/)/.test(candidate))calls.push({method:m.object==='api'?(m.method==='upload'?'POST':m.method.toUpperCase()):'UNSPECIFIED',path:candidate,...evidence(file,c)});
  }
  if(c.callee.name==='publishOperationsEvent'&&first)events.push({kind:'producer',event:first,...evidence(file,c)});
  if(file.includes('/test/')&&c.callee.name==='test'&&first)tests.push({name:first,...evidence(file,c)});
 }, BinaryExpression(p){const n=p.node;if(!['===','=='].includes(n.operator))return;const left=n.left,right=n.right;if(left.type==='MemberExpression'&&left.property.name==='type'&&str(right))events.push({kind:'consumer',event:str(right),...evidence(file,n)});}
 });
}
const shape=p=>p.split('?')[0].replace(/\{dynamic\}/g,'*').replace(/:[A-Za-z_][\w]*/g,'*').replace(/\/$/,'');
for(const c of calls)c.possibleServerRoutes=routes.filter(r=>(c.method==='UNSPECIFIED'||c.method===r.method)&&shape(c.path)===shape(r.path)).map(r=>({method:r.method,path:r.path,file:r.file,line:r.line}));
const result={schemaVersion:1,sourceRevision:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),verifiedAt:new Date().toISOString(),method:'Babel AST: mounted Express routers, client HTTP call sites, native string contracts, event names and test declarations. Static matches do not prove runtime behavior; dynamic calls and externally consumed routes can remain unmatched.',repositoryMap:{production:'madar-v2',legacy:'system (separate npm package; migration input; not the running MADAR V2 API)',separateProject:'madar-flow (separate workflow product; not n8n or MADAR V2 runtime)'},denominator:{mountedApiAndDownloadRouteDefinitions:routes.filter(r=>/^\/(api|download)(\/|$)/.test(r.path)).length,clientHttpCallSites:calls.length,nativePathLiterals:nativeCalls.length,testDeclarations:tests.length,eventEntries:events.length},routes,clientHttpCalls:calls,nativeHttpPaths:nativeCalls,events,tests};
fs.writeFileSync(path.join(__dirname,'source-inventory.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.denominator));
