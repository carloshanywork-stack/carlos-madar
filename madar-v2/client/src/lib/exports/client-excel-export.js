/**
 * MADAR Client-Side Excel Export Engine
 * Generates Excel workbooks (.xlsx) directly on the user's computer using SheetJS,
 * eliminating all server roundtrips and CPU load.
 */

export async function exportToExcelClient(data, options = {}) {
  const {
    sheetName = 'البيانات',
    fileName = `تقرير_مدار_${new Date().toISOString().slice(0, 10)}.xlsx`,
    columns = null,
  } = options;

  const XLSX = await import('xlsx');

  let rows = data;
  if (columns && Array.isArray(data)) {
    rows = data.map((item) => {
      const mapped = {};
      for (const [key, header] of Object.entries(columns)) {
        mapped[header] = item[key] ?? '';
      }
      return mapped;
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Set RTL direction on sheet
  ws['!views'] = [{ rightToLeft: true }];

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
  return true;
}

export async function exportMaintenanceCardsToExcel(order, cards = []) {
  const columns = {
    machine_code: 'رمز الآلة',
    machine_name: 'اسم الآلة / الموديل',
    client_name: 'العميل',
    area: 'المنطقة',
    region: 'المحافظة',
    condition: 'الحالة الفنية',
    reasons_text: 'أسباب العطل',
    technician_name: 'الفني / المندوب',
    updated_at: 'تاريخ الفحص',
  };

  const rows = cards.map((card) => ({
    machine_code: card.machine_code || card.machine?.code || '—',
    machine_name: card.machine_name || card.machine?.model || '—',
    client_name: order.client_name || '—',
    area: card.area || order.area || '—',
    region: card.region || order.region || '—',
    condition: card.condition === 'working' ? 'تعمل' : card.condition === 'stopped' ? 'معطلة' : 'تحتاج صيانة',
    reasons_text: (card.reasons || []).map((r) => r.name || r).join('، ') || 'صيانة دورية',
    technician_name: card.technician_name || '—',
    updated_at: card.updated_at ? new Date(card.updated_at).toLocaleDateString('ar-EG') : '—',
  }));

  return exportToExcelClient(rows, {
    sheetName: 'كروت الصيانة',
    fileName: `كروت_صيانة_${order.code || order.id}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    columns,
  });
}
