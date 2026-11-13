// Canonicalize SQL syntax, preserving literals, constraints and column definitions.
function tokens(sql) {
  return (sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g) ?? [])
    .map(token => token.startsWith("'") ? token : token.replace(/^["`\[]|["`\]]$/g,'').toLowerCase()).join(' ');
}
function tableDefinitions(sql) {
  const start=sql.indexOf('(');if(start<0)throw Error('Unsupported table schema.');
  let depth=0,quote=null,last=start+1,definitions=[];
  for(let i=start+1;i<sql.length;i++) {
    const c=sql[i];
    if(quote){if(c===quote){if(sql[i+1]===quote)i++;else quote=null;}continue;}
    if(c==="'"||c==='"'||c==='`'){quote=c;continue;}
    if(c==='(')depth++;
    if(c===')'){if(depth===0){definitions.push(sql.slice(last,i));return {definitions,suffix:tokens(sql.slice(i+1))};}depth--;}
    if(c===','&&depth===0){definitions.push(sql.slice(last,i));last=i+1;}
  }
  throw Error('Unbalanced table schema.');
}
export function schemaFingerprint(database, schema = 'main') {
  if (!['main','restored_snapshot'].includes(schema)) throw Error('Unsupported schema name.');
  return database.prepare(`SELECT type,name,sql FROM ${schema}.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all().map(row=>{
    if(row.type!=='table')return {...row,sql:tokens(row.sql??'')};
    const parsed=tableDefinitions(row.sql);
    const definitions=parsed.definitions.map(tokens).map(definition=>{
      // Historical additive migration used a nullable technical timestamp. The
      // recorded migration backfills it before compatibility/copy validation.
      if(row.name==='machines' && definition==='updated_at text') {
        if(database.prepare(`SELECT 1 FROM ${schema}.machines WHERE updated_at IS NULL LIMIT 1`).get())throw Error('Machine update timestamps need the supported migration.');
        return 'updated_at text not null default current_timestamp';
      }
      return definition;
    }).sort();
    return {...row,sql:JSON.stringify({definitions,suffix:parsed.suffix})};
  });
}
export function migrateMachineTimestampMetadata(database) {
  const version='20261113-machine-updated-at-null-backfill';
  if(database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version))return;
  database.transaction(()=>{
    // created_at supplies initial technical update metadata, not a new business event.
    database.prepare('UPDATE machines SET updated_at=created_at WHERE updated_at IS NULL').run();
    database.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
  })();
}
