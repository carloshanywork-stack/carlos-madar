export function hasUniversalRegionAccess(regions) {
  if (!Array.isArray(regions) || regions.length === 0) return true;
  return regions.some((region) => ['*', 'all', 'الكل'].includes(
    String(region ?? '').normalize('NFKC').trim().toLocaleLowerCase('ar'),
  ));
}

export function regionAccessLabel(regions) {
  return hasUniversalRegionAccess(regions) ? 'كافة المناطق' : regions.join('، ');
}
