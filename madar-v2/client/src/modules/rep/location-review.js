export const locationReviewState = (status) => status === 'pending' ? 'pending_approval' : status;
export const locationReviewLabel = (status) => ({
  queued: 'بانتظار المزامنة', syncing: 'جارٍ الإرسال', blocked: 'تحتاج مراجعة',
  pending_approval: 'بانتظار اعتماد المدير', approved: 'معتمد', rejected: 'مرفوض؛ أرسل مقترحاً مصححاً',
})[status] ?? 'بانتظار المزامنة';

export function isFreshGpsFix(location, now = Date.now(), maxAgeMs = 2 * 60_000) {
  const capturedAt = Date.parse(location?.updatedAt ?? '');
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude)
    && location.latitude >= -90 && location.latitude <= 90
    && location.longitude >= -180 && location.longitude <= 180
    && Number.isFinite(location?.accuracy) && location.accuracy >= 0 && location.accuracy <= 100
    && Number.isFinite(capturedAt) && capturedAt <= now + 30_000 && now - capturedAt <= maxAgeMs;
}

function straightLineDistanceMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(second.latitude - first.latitude);
  const dLon = radians(second.longitude - first.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function orderMachinesByStraightLineDistance(machines, gps) {
  const located = [];
  const needsLocation = [];
  for (const machine of machines ?? []) {
    const hasApprovedLocation = machine.isLocationLocked === true
      && machine.approvedLocation && typeof machine.approvedLocation === 'object'
      && Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude);
    if (!hasApprovedLocation) {
      needsLocation.push(machine);
      continue;
    }
    located.push(gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)
      ? { ...machine, straightLineDistanceMeters: straightLineDistanceMeters(gps, machine) }
      : machine);
  }
  if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
    located.sort((left, right) => left.straightLineDistanceMeters - right.straightLineDistanceMeters
      || String(left.machineCode).localeCompare(String(right.machineCode), 'ar', { numeric: true }));
  }
  return { located, needsLocation };
}

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
      const legacyOptimistic = status !== 'approved' && (
        (!Object.hasOwn(machine, 'approvedLocation') && machine.isLocationLocked)
        || (machine.locationConfirmationPending && !machine.approvedLocation)
      );
      const approved = machine.approvedLocation;
      const identityPending = local.some((action) => action.type === 'report_correction');
      const approvedVisitAllowed = !identityPending && !legacyOptimistic
        && !machine.isCompleted && !machine.isSubmitted && !machine.correctionPending
        && (!machine.workOwnerId || Number(machine.workOwnerId) === Number(proposal?.repId));
      return {
        ...machine,
        ...(legacyOptimistic ? { latitude: null, longitude: null, isLocationLocked: false } : {}),
        ...(approved ? { latitude: approved.latitude, longitude: approved.longitude, isLocationLocked: true } : {}),
        ...(status === 'approved' && proposal?.payload?.location ? {
          latitude: proposal.payload.location.latitude,
          longitude: proposal.payload.location.longitude,
          approvedLocation: { latitude: proposal.payload.location.latitude, longitude: proposal.payload.location.longitude },
          isLocationLocked: true,
        } : {}),
        locationConfirmation: remoteMatches ? remote : proposal ? {
          actionUuid: proposal.actionUuid, status: proposal.status,
          proposedLocation: proposal.payload?.location, reviewNote: proposal.reviewNote ?? null,
        } : remote ?? null,
        locationReviewState: status ?? null,
        locationConfirmationPending: awaiting,
        ...(awaiting || identityPending || legacyOptimistic ? { canVisit: false } : {}),
        ...(status === 'approved' && proposal && approvedVisitAllowed ? { canVisit: true } : {}),
        ...(identityPending ? { correctionPending: true } : {}),
      };
    }),
  })) };
}
