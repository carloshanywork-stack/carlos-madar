let lockTail = Promise.resolve();
const machineLockTails = new Map();

export async function withMaintenanceOrderStorageLock(callback) {
  const previous = lockTail;
  let release;
  lockTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await callback();
  } finally {
    release();
  }
}

export async function withMachineStorageLock(machineId, callback) {
  const key = String(machineId);
  const previous = machineLockTails.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  machineLockTails.set(key, current);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (machineLockTails.get(key) === current) machineLockTails.delete(key);
  }
}
