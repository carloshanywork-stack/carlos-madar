export function normalizeArabicSortKey(value) {
  if (!value) return '';
  let str = String(value).trim();

  const leadingDigits = str.match(/^([\d\s_.-]+)([\u0600-\u06FF].*)$/);
  if (leadingDigits) {
    str = `${leadingDigits[2].trim()} ${leadingDigits[1].trim()}`;
  }

  return str
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0625\u0623\u0622\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A');
}

export function compareMachineCodes(codeA, codeB) {
  const strA = String(codeA ?? '').trim();
  const strB = String(codeB ?? '').trim();
  const numA = Number.parseInt(strA.replace(/\D+/g, ''), 10);
  const numB = Number.parseInt(strB.replace(/\D+/g, ''), 10);

  if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
    return numA - numB;
  }
  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
}

export function compareMachineNames(nameA, nameB) {
  const strA = String(nameA ?? '').trim();
  const strB = String(nameB ?? '').trim();
  if (!strA && !strB) return 0;
  if (!strA) return 1;
  if (!strB) return -1;

  const keyA = normalizeArabicSortKey(strA);
  const keyB = normalizeArabicSortKey(strB);
  const isArabicA = /^[\u0600-\u06FF]/.test(keyA);
  const isArabicB = /^[\u0600-\u06FF]/.test(keyB);
  if (isArabicA && !isArabicB) return -1;
  if (!isArabicA && isArabicB) return 1;

  return keyA.localeCompare(keyB, 'ar-EG', { sensitivity: 'base', numeric: true });
}

export function compareMaintenanceAreas(areaA, areaB) {
  const keyA = normalizeArabicSortKey(areaA);
  const keyB = normalizeArabicSortKey(areaB);
  return keyA.localeCompare(keyB, 'ar-EG', { sensitivity: 'base', numeric: true });
}
