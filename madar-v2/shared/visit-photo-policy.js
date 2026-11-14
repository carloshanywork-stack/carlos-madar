/** Missing policy is the immutable legacy contract, retained for queued upgrades/replays. */
export const VISIT_PHOTO_POLICY_VERSION = 2;
export const MAX_VISIT_PHOTOS_PER_PHASE = 20;
export function validVisitPhotoCounts(policy, before, after) {
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || after < 0) return false;
  if (policy === undefined) return before === 3 && after <= 3;
  return policy === VISIT_PHOTO_POLICY_VERSION && before >= 1 && after >= 1
    && before <= MAX_VISIT_PHOTOS_PER_PHASE && after <= MAX_VISIT_PHOTOS_PER_PHASE;
}
