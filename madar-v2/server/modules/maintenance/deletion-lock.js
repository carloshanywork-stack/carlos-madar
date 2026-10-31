let lockTail = Promise.resolve();

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
