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

const maintenanceAreaLocations = [
  // 1. Alexandria, the Mediterranean coast, Matrouh, then Sadat City.
  { group: 1, order: 10, aliases: ['الإسكندرية', 'اسكندرية', 'alexandria'] },
  { group: 1, order: 20, aliases: ['الساحل الشمالي', 'الساحل', 'north coast'] },
  { group: 1, order: 30, aliases: ['مرسى مطروح', 'مطروح', 'matrouh', 'marsa matrouh'] },
  { group: 1, order: 40, aliases: ['مدينة السادات', 'السادات', 'sadat city', 'el sadat'] },

  // 2. Delta governorates and Canal cities, in the requested route order.
  { group: 2, order: 10, aliases: [
    'الدلتا', 'محافظة الدقهلية', 'الدقهلية', 'dakahlia', 'daqahliyah', 'المنصورة', 'mansoura',
    'طنطا', 'الغربية', 'gharbia', 'المحلة الكبرى', 'كفر الشيخ', 'kafr el sheikh',
    'البحيرة', 'beheira', 'دمنهور', 'المنوفية', 'monufia', 'الشرقية', 'sharqia', 'الزقازيق',
    'القليوبية', 'qalyubia', 'بنها', 'delta',
  ] },
  { group: 2, order: 20, aliases: ['بورسعيد', 'port said'] },
  { group: 2, order: 30, aliases: ['دمياط', 'damietta'] },
  { group: 2, order: 31, aliases: ['راس البر', 'رأس البر', 'ras el bar'] },
  { group: 2, order: 40, aliases: ['العاشر من رمضان', '10th of ramadan', '10th ramadan', '10th of ramadan city'] },
  { group: 2, order: 41, aliases: ['الإسماعيلية', 'اسماعيلية', 'ismailia'] },
  { group: 2, order: 50, aliases: ['السويس', 'سويس', 'suez'] },
  { group: 2, order: 51, aliases: ['العين السخنة', 'ain sokhna', 'ain el sokhna'] },

  // 3. Greater Cairo and suburbs.
  { group: 3, order: 0, aliases: ['القاهرة الكبرى', 'greater cairo', 'القاهرة', 'cairo'] },
  { group: 3, order: 10, aliases: ['رمسيس', 'ramses'] },
  { group: 3, order: 11, aliases: ['شبرا', 'shoubra', 'shubra'] },
  { group: 3, order: 20, aliases: ['مصر الجديدة', 'هليوبوليس', 'heliopolis'] },
  { group: 3, order: 21, aliases: ['مدينة نصر', 'nasr city'] },
  { group: 3, order: 30, aliases: ['التجمع الخامس', 'التجمع', 'تجمع', 'القاهرة الجديدة', 'fifth settlement', 'new cairo'] },
  { group: 3, order: 40, aliases: ['الدقي', 'dokki'] },
  { group: 3, order: 41, aliases: ['المعادي', 'maadi'] },
  { group: 3, order: 50, aliases: ['6 اكتوبر', 'السادس من اكتوبر', 'october'] },
  { group: 3, order: 51, aliases: ['حدائق الاهرام', 'الاهرام'] },
  { group: 3, order: 52, aliases: ['الشيخ زايد', 'sheikh zayed', 'giza', 'الجيزه'] },

  // 4. Sinai / Red Sea, then 5. Upper Egypt from north to south.
  { group: 4, order: 10, aliases: ['شرم الشيخ', 'sharm el sheikh'] },
  { group: 4, order: 11, aliases: ['دهب', 'dahab'] },
  { group: 4, order: 12, aliases: ['طابا', 'نويبع', 'سانت كاترين', 'سيناء', 'sinai'] },
  { group: 4, order: 20, aliases: ['الغردقة', 'hurghada'] },
  { group: 4, order: 30, aliases: ['البحر الاحمر', 'سفاجا', 'مرسى علم', 'red sea', 'marsa alam', 'safaga'] },
  { group: 5, order: 10, aliases: ['شمال الصعيد', 'north upper egypt'] },
  { group: 5, order: 15, aliases: ['الصعيد', 'upper egypt'] },
  { group: 5, order: 20, aliases: ['جنوب الصعيد', 'south upper egypt'] },
].map((location) => ({
  ...location,
  aliases: location.aliases.map((alias) => normalizeArabicSortKey(alias).toLocaleLowerCase('ar-EG')),
}));

function maintenanceAreaLocation(area) {
  const key = normalizeArabicSortKey(area).toLocaleLowerCase('ar-EG');
  let match = null;
  let matchedAliasLength = -1;
  for (const location of maintenanceAreaLocations) {
    for (const alias of location.aliases) {
      if (alias.length > matchedAliasLength && key.includes(alias)) {
        match = location;
        matchedAliasLength = alias.length;
      }
    }
  }
  return match ?? { group: 6, order: 0 };
}

export function compareMaintenanceAreas(areaA, areaB) {
  const keyA = normalizeArabicSortKey(areaA);
  const keyB = normalizeArabicSortKey(areaB);
  const locationA = maintenanceAreaLocation(keyA);
  const locationB = maintenanceAreaLocation(keyB);
  return locationA.group - locationB.group
    || locationA.order - locationB.order
    || keyA.localeCompare(keyB, 'ar-EG', { sensitivity: 'base', numeric: true });
}
