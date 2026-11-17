import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeArabicText, searchItemsLocally } from '../client/src/lib/search/local-search.js';
import { exportMaintenanceCardsToExcel } from '../client/src/lib/exports/client-excel-export.js';

test('Arabic text normalizer cleans diacritics, alifs, and taa marbuta', () => {
  assert.equal(normalizeArabicText('القَاهِرَةُ'), 'القاهره');
  assert.equal(normalizeArabicText('إبراهيم'), 'ابراهيم');
  assert.equal(normalizeArabicText('أحمد'), 'احمد');
  assert.equal(normalizeArabicText('آلة'), 'اله');
  assert.equal(normalizeArabicText('مستشفى'), 'مستشفي');
});

test('local in-memory search performs instant multi-token search across Arabic fields', () => {
  const items = [
    { code: 'M-101', name: 'ماكينة خياطة سنجر', area: 'مدينة نصر', client: 'مصنع الأمل' },
    { code: 'M-102', name: 'ماكينة أوفر لوك جوكي', area: 'العاشر من رمضان', client: 'شركة النصر' },
    { code: 'M-103', name: 'مكواة بخار صناعي', area: 'مدينة نصر', client: 'مصنع الأمل' },
  ];

  // Specific multi-token search
  const res1 = searchItemsLocally(items, 'خياطه نصر');
  assert.equal(res1.length, 1);
  assert.equal(res1[0].code, 'M-101');

  // Search by machine code
  const res2 = searchItemsLocally(items, 'M-103');
  assert.equal(res2.length, 1);
  assert.equal(res2[0].name, 'مكواة بخار صناعي');

  // Empty query returns all items
  const res3 = searchItemsLocally(items, '');
  assert.equal(res3.length, 3);
});

test('client Excel export generates valid workbook structure without server dependency', async () => {
  const dummyOrder = { id: 42, code: 'ORD-2026-42', client_name: 'شركة النور' };
  const dummyCards = [
    { machine_code: 'MC-01', machine_name: 'غلاية بخار', condition: 'working', reasons: ['تنظيف فلاتر'] },
    { machine_code: 'MC-02', machine_name: 'ضاغط هواء', condition: 'stopped', reasons: ['تسريب زيت'] },
  ];

  const { wb, fileName } = await exportMaintenanceCardsToExcel(dummyOrder, dummyCards, { download: false });
  assert.ok(wb.SheetNames.includes('كروت الصيانة'));
  assert.ok(fileName.includes('ORD-2026-42'));
  const sheet = wb.Sheets['كروت الصيانة'];
  assert.ok(sheet['A1']);
  assert.equal(sheet['A1'].v, 'رمز الآلة');
});
