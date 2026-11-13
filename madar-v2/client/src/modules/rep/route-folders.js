const arabicNameOrder = new Intl.Collator('ar-EG', { sensitivity: 'base', numeric: true });

/** Keep the assigned-region folders independent from GPS and map ordering. */
export function groupRouteMachinesByRegion(regions, predicate = () => true) {
  const grouped = new Map();
  for (const region of regions ?? []) {
    const regionName = region.regionName || 'منطقة غير محددة';
    for (const machine of region.machines ?? []) {
      const entry = { ...machine, regionName };
      if (!predicate(entry)) continue;
      if (!grouped.has(regionName)) grouped.set(regionName, []);
      grouped.get(regionName).push(entry);
    }
  }
  return [...grouped].sort(([left], [right]) => arabicNameOrder.compare(left, right))
    .map(([regionName, machines]) => ({
      regionName,
      machines: machines.sort((left, right) =>
        arabicNameOrder.compare(left.arabicName || left.machineCode || '', right.arabicName || right.machineCode || '')
        || arabicNameOrder.compare(left.machineCode || '', right.machineCode || '')
        || Number(left.cardId || 0) - Number(right.cardId || 0)),
    }));
}
