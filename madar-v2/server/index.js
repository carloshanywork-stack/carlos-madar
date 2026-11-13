import { app } from './app.js';
import { env } from './config/env.js';
import { db } from './database/connection.js';
import { initializeDatabase } from './database/init.js';
import { startDatabaseMaintenanceScheduler, stopDatabaseMaintenanceScheduler } from './database/maintenance.js';
import { recoverInterruptedRestore, startSystemBackupScheduler, stopSystemBackupScheduler } from './modules/system/backup.js';
import {
  recoverMaintenanceCardDeletions,
  recoverMachineCorrectionRenames,
  recoverMaintenanceMachineDecommissions,
  recoverMaintenanceOrderDeletions,
  recoverTestMockPurges,
  recoverUnmatchedMaintenanceFolderDeletions,
} from './modules/maintenance/service.js';
import { recoverRepVisitUploads } from './modules/rep/service.js';
import { startOperationsOutboxScheduler, publishOperationsEvent } from './modules/operations-events.js';

const initialization = initializeDatabase();
try {
  await recoverInterruptedRestore();
  const testPurgeRecovery = await recoverTestMockPurges();
  if (testPurgeRecovery.recoveredCount) {
    console.log(`Recovered ${testPurgeRecovery.recoveredCount} staged test fixture purge(s).`);
  }
  const recovery = await recoverMaintenanceOrderDeletions();
  if (recovery.recoveredCount) {
    console.log(`Recovered ${recovery.recoveredCount} staged maintenance order deletion(s).`);
  }
  const cardRecovery = await recoverMaintenanceCardDeletions();
  if (cardRecovery.recoveredCount) {
    console.log(`Recovered ${cardRecovery.recoveredCount} staged maintenance card deletion(s).`);
  }
  const machineRecovery = await recoverMaintenanceMachineDecommissions();
  if (machineRecovery.recoveredCount) {
    console.log(`Recovered ${machineRecovery.recoveredCount} staged machine decommission(s).`);
  }
  const machineCorrectionRecovery = await recoverMachineCorrectionRenames();
  if (machineCorrectionRecovery.recoveredCount) {
    console.log(`Recovered ${machineCorrectionRecovery.recoveredCount} machine correction rename(s).`);
  }
  const unmatchedRecovery = await recoverUnmatchedMaintenanceFolderDeletions();
  if (unmatchedRecovery.recoveredCount) {
    console.log(`Recovered ${unmatchedRecovery.recoveredCount} staged unmatched-folder purge(s).`);
  }
  const repVisitRecovery = await recoverRepVisitUploads();
  if (repVisitRecovery.recoveredCount) {
    console.log(`Recovered ${repVisitRecovery.recoveredCount} interrupted field-rep visit upload(s).`);
  }
} catch (error) {
  console.error(`Persistent file recovery failed; API startup stopped: ${error.message}`);
  if (db.open) db.close();
  throw error;
}

if (initialization.adminCreated) {
  console.log('Created initial MADAR V2 administrator.');
  console.log('Initial administrator password was read from MADAR_INITIAL_ADMIN_PASSWORD.');
} else if (initialization.setupRequired) {
  console.log('If this is a new install, finish first administrator setup in the browser.');
} else {
  console.log('Existing MADAR V2 user accounts and credentials were left unchanged.');
}

const server = app.listen(env.port, env.host, () => {
  console.log(`MADAR V2 API listening at http://${env.host}:${env.port}`);
  startOperationsOutboxScheduler();
  startSystemBackupScheduler();
  startDatabaseMaintenanceScheduler();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const scheduledBackup = stopSystemBackupScheduler();
  stopDatabaseMaintenanceScheduler();
  console.log(`${signal} received; shutting down MADAR V2.`);
  publishOperationsEvent('system.shutdown');
  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed:', error);
      process.exitCode = 1;
    }
    void scheduledBackup.finally(() => {
      if (db.open) db.close();
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
