/**
 * MADAR Local In-Memory Search Engine
 * Provides sub-millisecond full-text and fuzzy search directly in the browser,
 * with Arabic orthographic normalization (alif/taa marbuta/diacritics).
 */

export function normalizeArabicText(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .toLowerCase()
    // Remove Arabic diacritics (tashkeel)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Normalize alifs
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize taa marbuta
    .replace(/ة/g, 'ه')
    // Normalize alif maqsura
    .replace(/ى/g, 'ي')
    // Replace multiple spaces with a single space
    .replace(/\s+/g, ' ');
}

export function searchItemsLocally(items = [], query = '', searchFields = []) {
  if (!query || !query.trim()) return items;
  if (!items || !items.length) return [];

  const normalizedQuery = normalizeArabicText(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  return items.filter((item) => {
    // Generate normalized searchable string from specified fields
    let searchableHaystack = '';
    if (searchFields.length > 0) {
      searchableHaystack = searchFields
        .map((field) => normalizeArabicText(item[field]))
        .join(' ');
    } else {
      searchableHaystack = normalizeArabicText(
        Object.values(item)
          .filter((v) => typeof v === 'string' || typeof v === 'number')
          .join(' '),
      );
    }

    // Every token in query must be present in haystack (AND matching)
    return queryTokens.every((token) => searchableHaystack.includes(token));
  });
}
