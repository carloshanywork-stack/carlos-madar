import { execFileSync } from 'node:child_process';
import { projectRoot } from './paths.js';
let sourceRevision = null;
let sourceDirty = null;
const sourceTrees = {};
if (process.env.NODE_ENV !== 'test') {
  try {
    sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: projectRoot, encoding:'utf8', timeout:2000}).trim();
    for (const path of ['server','shared','client/src','client/public','android/app/src/main/java','android/version.properties']) {
      sourceTrees[path] = execFileSync('git',['rev-parse',`HEAD:madar-v2/${path}`],{cwd:projectRoot,encoding:'utf8',timeout:2000}).trim();
    }
    sourceDirty = Boolean(execFileSync('git', ['status','--porcelain'], {cwd:projectRoot,encoding:'utf8',timeout:2000}).trim());
  } catch { /* Explicitly unknown, never borrow a build's unrelated identity. */ }
}
// Capture once when this process loads, rather than reading a moving checkout on each request.
export const runtimeIdentity = Object.freeze({sourceRevision, sourceDirty, sourceTrees:Object.freeze(sourceTrees), startedAt:new Date().toISOString()});
