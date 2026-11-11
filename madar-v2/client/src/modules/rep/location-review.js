export const locationReviewState = (status) => status === 'pending' ? 'pending_approval' : status;
export const locationReviewLabel = (status) => ({
  queued: 'بانتظار المزامنة', syncing: 'جارٍ الإرسال', blocked: 'تحتاج مراجعة',
  pending_approval: 'بانتظار اعتماد المدير', approved: 'معتمد', rejected: 'مرفوض؛ أرسل مقترحاً مصححاً',
})[status] ?? 'بانتظار المزامنة';

/** Overlay proposals without ever promoting them to approved coordinates. */
export function applyPendingMachineLocations(route, actions = []) {
  if (!route?.regions) return route;
  return { ...route, regions: route.regions.map((region) => ({
    ...region,
    machines: region.machines.map((machine) => {
      const local = actions.filter((action) => Number(action.machineId) === Number(machine.machineId));
      const proposal = local.filter((action) => action.type === 'confirm_location').at(-1);
      const remote = machine.locationConfirmation;
      const remoteMatches = remote && (!proposal || remote.actionUuid === proposal.actionUuid);
      const status = remoteMatches ? locationReviewState(remote.status) : proposal?.status;
      const awaiting = ['queued', 'syncing', 'blocked', 'pending_approval'].includes(status);
      const legacyOptimistic = (!Object.hasOwn(machine, 'approvedLocation') && machine.isLocationLocked)
        || (machine.locationConfirmationPending && !machine.approvedLocation);
      const approved = machine.approvedLocation;
      const identityPending = local.some((action) => action.type === 'report_correction');
      return {
        ...machine,
        ...(legacyOptimistic ? { latitude: null, longitude: null, isLocationLocked: false } : {}),
        ...(approved ? { latitude: approved.latitude, longitude: approved.longitude, isLocationLocked: true } : {}),
        locationConfirmation: remoteMatches ? remote : proposal ? {
          actionUuid: proposal.actionUuid, status: proposal.status,
          proposedLocation: proposal.payload?.location, reviewNote: proposal.reviewNote ?? null,
        } : remote ?? null,
        locationReviewState: status ?? null,
        locationConfirmationPending: awaiting,
        ...(awaiting || identityPending || legacyOptimistic ? { canVisit: false } : {}),
        ...(identityPending ? { correctionPending: true } : {}),
      };
    }),
  })) };
}
