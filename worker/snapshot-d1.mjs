/** D1 adapter for shared snapshots and separately namespaced PRIVATE user state.
 * Migrations own editor_snapshots; never create/alter tables inside a request.
 * Caller enforces authorization before writes and private reads. Never expose
 * arbitrary keys via a public endpoint: shared reads use one fixed snapshot key.
 */
export function createD1SnapshotStore(database,{makeVersion=()=>crypto.randomUUID(),maxBytes=2000000}={}){
  if(!database||typeof database.prepare!=='function')throw new Error('d1_unavailable');
  // A primary-first session preserves read-after-write consistency if replication is enabled.
  const db=typeof database.withSession==='function'?database.withSession('first-primary'):database;
  function checkKey(key){if(typeof key!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/.test(key))throw new Error('state_key_invalid');}
  return {
    async read(key){checkKey(key);const row=await db.prepare('SELECT version, value AS value_json FROM editor_snapshots WHERE key = ?').bind(key).first();if(!row)return {version:null,value:null};if(typeof row.version!=='string'||!row.version||typeof row.value_json!=='string'||new TextEncoder().encode(row.value_json).byteLength>maxBytes)throw new Error('state_corrupt');let value;try{value=JSON.parse(row.value_json);}catch{throw new Error('state_corrupt');}return {version:row.version,value};},
    async compareAndSwap(key,expectedVersion,value){
      checkKey(key);if(expectedVersion!==null&&(typeof expectedVersion!=='string'||!expectedVersion||expectedVersion.length>200))throw new Error('state_version_invalid');
      let text;try{text=JSON.stringify(value,(_k,v)=>{if(['function','undefined','symbol','bigint'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))throw new Error('invalid');return v;});}catch{throw new Error('state_value_invalid');}
      if(!text||text==='null'||new TextEncoder().encode(text).byteLength>maxBytes)throw new Error('state_value_invalid');
      const version=makeVersion();if(typeof version!=='string'||!version||version.length>200||version===expectedVersion)throw new Error('state_version_invalid');
      const result=expectedVersion===null
        ?await db.prepare('INSERT INTO editor_snapshots (key, version, value) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING').bind(key,version,text).run()
        :await db.prepare('UPDATE editor_snapshots SET version = ?, value = ? WHERE key = ? AND version = ?').bind(version,text,key,expectedVersion).run();
      if(result?.success===false||![0,1].includes(result?.meta?.changes))throw new Error('state_write_failed');
      return result.meta.changes===1?{applied:true,version}:{applied:false,version:null};
    }
  };
}
