import {chmodSync,existsSync,lstatSync} from 'node:fs';
/** Restrict only real files owned by this service account; never follow a symlink. */
export function securePrivateFile(path) {
  if(process.platform==='win32'||!existsSync(path))return;
  const info=lstatSync(path);
  if(info.isSymbolicLink()||!info.isFile())throw new Error('Private configuration/database path must be a regular file.');
  if(typeof process.getuid==='function'&&info.uid!==process.getuid())throw new Error('Private file ownership does not match the service account.');
  chmodSync(path,0o600);
}
