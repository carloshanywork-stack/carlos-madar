import * as XLSX from 'xlsx';
import { listMaterials, listOffcuts } from './service.js';

export function buildWarehouseWorkbook(database) {
  const workbook = XLSX.utils.book_new();
  const materials = listMaterials(database).map((item) => ({
    'كود الصنف': item.code,
    'اسم الصنف': item.name,
    'المواصفات': item.specification ?? '',
    'الوحدة': item.unit,
    'الرصيد الرئيسي': item.stock,
    'حد إعادة الطلب': item.min_stock,
    'تكلفة الوحدة (قرش)': item.unit_cost_cents,
    'نشط': item.active ? 'نعم' : 'لا',
  }));
  const offcuts = listOffcuts('all', database).map((item) => ({
    'كود الصنف': item.material_code ?? '',
    'اسم الباقي': item.name,
    'الأبعاد': item.dimensions,
    'الكمية': item.quantity,
    'الوحدة': item.unit,
    'تكلفة الوحدة (قرش)': item.unit_cost_cents,
    'الحالة': item.status,
    'أمر التصنيع': item.origin_workshop_order_code ?? '',
    'ملاحظات': item.notes ?? '',
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(materials), 'المخزون الرئيسي');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(offcuts), 'البواقي');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}
