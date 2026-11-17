/**
 * MADAR Client-Side PowerPoint Export Engine
 * Builds rich, formatted maintenance presentations (.pptx) directly on the client,
 * using PptxGenJS and local canvas-based photo downscaling.
 */

import { compressImageOnClient, imageToDataUrl } from '../workers/image-processor.js';
import { getCachedPhotoUrl } from '../cache/photo-cache.js';

export async function exportMaintenanceOrderToPptxClient(order, cards = [], options = {}) {
  const { onProgress = () => {} } = options;

  onProgress(5, 'تحميل محرك العروض التقديمية...');
  const PptxGenJSModule = await import('pptxgenjs');
  const PptxGenJS = PptxGenJSModule.default || PptxGenJSModule;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 16:9 widescreen
  pptx.rtlMode = true;

  const orderTitle = order.code || `أمر صيانة #${order.id}`;
  const clientName = order.client_name || 'العميل';
  const exportDate = new Date().toLocaleDateString('ar-EG');

  // Slide 1: Cover Slide
  onProgress(15, 'إنشاء شريحة الغلاف...');
  const coverSlide = pptx.addSlide();
  coverSlide.background = { color: '15243A' }; // MADAR Ink

  coverSlide.addText('MADAR ERP · مدار لإدارة الصيانة', {
    x: 0.8,
    y: 1.2,
    w: 11.5,
    h: 0.6,
    fontSize: 18,
    color: '38BDF8',
    bold: true,
    rtl: true,
  });

  coverSlide.addText('تقرير فحص وصيانة الآلات الميدانية', {
    x: 0.8,
    y: 2.2,
    w: 11.5,
    h: 1.2,
    fontSize: 34,
    color: 'FFFFFF',
    bold: true,
    rtl: true,
  });

  coverSlide.addText(`العميل: ${clientName}\nرمز الأمر: ${orderTitle}\nالتاريخ: ${exportDate}\nعدد الآلات المفحوصة: ${cards.length} آلة`, {
    x: 0.8,
    y: 3.8,
    w: 11.5,
    h: 2.0,
    fontSize: 16,
    color: 'CBD5E1',
    lineSpacing: 28,
    rtl: true,
  });

  // Slide 2: Index Slide
  onProgress(25, 'تجميع جدول الفهرس...');
  const indexSlide = pptx.addSlide();
  indexSlide.background = { color: 'F8FAFC' };

  indexSlide.addText('فهرس الآلات والأعمال المنجزة', {
    x: 0.8,
    y: 0.5,
    w: 11.5,
    h: 0.6,
    fontSize: 22,
    color: '15243A',
    bold: true,
    rtl: true,
  });

  const tableRows = [
    [
      { text: 'م', options: { bold: true, fill: '1E293B', color: 'FFFFFF' } },
      { text: 'كود الآلة', options: { bold: true, fill: '1E293B', color: 'FFFFFF' } },
      { text: 'المنطقة', options: { bold: true, fill: '1E293B', color: 'FFFFFF' } },
      { text: 'الحالة الفنية', options: { bold: true, fill: '1E293B', color: 'FFFFFF' } },
      { text: 'الأعطال المنفذة', options: { bold: true, fill: '1E293B', color: 'FFFFFF' } },
    ],
  ];

  cards.forEach((card, idx) => {
    tableRows.push([
      { text: String(idx + 1) },
      { text: card.machine_code || card.machine?.code || '—' },
      { text: card.area || order.area || '—' },
      { text: card.condition === 'working' ? 'تعمل' : 'تحتاج صيانة' },
      { text: (card.reasons || []).map((r) => r.name || r).join('، ') || 'صيانة دورية' },
    ]);
  });

  indexSlide.addTable(tableRows.slice(0, 15), {
    x: 0.8,
    y: 1.4,
    w: 11.7,
    colW: [0.6, 2.2, 2.4, 2.0, 4.5],
    fontSize: 11,
    border: { pt: 0.5, color: 'CBD5E1' },
    fill: 'FFFFFF',
    align: 'center',
  });

  // Slide 3+: Individual Machine Cards with Before & After Photos
  const totalCards = cards.length;
  for (let i = 0; i < totalCards; i++) {
    const card = cards[i];
    const progressPercent = Math.round(30 + ((i + 1) / totalCards) * 60);
    onProgress(progressPercent, `معالجة صور الآلة ${i + 1} من ${totalCards}...`);

    const cardSlide = pptx.addSlide();
    cardSlide.background = { color: 'FFFFFF' };

    // Card Header Bar
    cardSlide.addShape(pptx.shapes.RECTANGLE, {
      x: 0,
      y: 0,
      w: 13.33,
      h: 0.9,
      fill: { color: '15243A' },
      line: { color: '15243A' },
    });

    const mCode = card.machine_code || card.machine?.code || 'آلة';
    const mModel = card.machine_name || card.machine?.model || '';
    cardSlide.addText(`${mCode} ${mModel ? `· ${mModel}` : ''} | المنطقة: ${card.area || order.area || '—'}`, {
      x: 0.6,
      y: 0.15,
      w: 12.0,
      h: 0.6,
      fontSize: 16,
      bold: true,
      color: 'FFFFFF',
      rtl: true,
    });

    // Before Photo Box
    cardSlide.addText('صورة قبل الصيانة (Before)', {
      x: 0.8,
      y: 1.1,
      w: 5.5,
      h: 0.4,
      fontSize: 13,
      bold: true,
      color: 'DC2626', // Red
      rtl: true,
    });

    const beforeUrl = card.photos_before?.[0] || card.before_photo_url;
    if (beforeUrl) {
      try {
        const cachedUrl = await getCachedPhotoUrl(beforeUrl);
        const dataUrl = await imageToDataUrl(cachedUrl);
        cardSlide.addImage({
          data: dataUrl,
          x: 0.8,
          y: 1.55,
          w: 5.5,
          h: 4.1,
          sizing: { type: 'contain', w: 5.5, h: 4.1 },
        });
      } catch {
        cardSlide.addText('تعذر تحميل الصورة', { x: 0.8, y: 3.0, w: 5.5, h: 1, align: 'center', color: '94A3B8' });
      }
    } else {
      cardSlide.addText('لا توجد صورة مسجلة قبل الصيانة', { x: 0.8, y: 3.0, w: 5.5, h: 1, align: 'center', color: '94A3B8', rtl: true });
    }

    // After Photo Box
    cardSlide.addText('صورة بعد الصيانة (After)', {
      x: 7.0,
      y: 1.1,
      w: 5.5,
      h: 0.4,
      fontSize: 13,
      bold: true,
      color: '059669', // Green
      rtl: true,
    });

    const afterUrl = card.photos_after?.[0] || card.after_photo_url;
    if (afterUrl) {
      try {
        const cachedUrl = await getCachedPhotoUrl(afterUrl);
        const dataUrl = await imageToDataUrl(cachedUrl);
        cardSlide.addImage({
          data: dataUrl,
          x: 7.0,
          y: 1.55,
          w: 5.5,
          h: 4.1,
          sizing: { type: 'contain', w: 5.5, h: 4.1 },
        });
      } catch {
        cardSlide.addText('تعذر تحميل الصورة', { x: 7.0, y: 3.0, w: 5.5, h: 1, align: 'center', color: '94A3B8' });
      }
    } else {
      cardSlide.addText('لا توجد صورة مسجلة بعد الصيانة', { x: 7.0, y: 3.0, w: 5.5, h: 1, align: 'center', color: '94A3B8', rtl: true });
    }

    // Bottom Details Panel
    const reasonsStr = (card.reasons || []).map((r) => r.name || r).join('، ') || 'صيانة دورية';
    const notesStr = card.notes ? `ملاحظات: ${card.notes}` : '';
    cardSlide.addShape(pptx.shapes.RECTANGLE, {
      x: 0.8,
      y: 5.8,
      w: 11.7,
      h: 1.4,
      fill: { color: 'F1F5F9' },
      line: { color: 'CBD5E1', width: 1 },
    });

    cardSlide.addText(`الإجراءات والأعطال: ${reasonsStr}\nالحالة الفنية: ${card.condition === 'working' ? 'تعمل بشكل سليم' : 'تحتاج متابعة'} ${notesStr ? `· ${notesStr}` : ''}`, {
      x: 1.0,
      y: 5.9,
      w: 11.3,
      h: 1.2,
      fontSize: 12,
      color: '1E293B',
      lineSpacing: 20,
      rtl: true,
    });
  }

  onProgress(95, 'حفظ وتجهيز ملف PowerPoint للتنزيل...');
  const fileName = `تقرير_صيانة_${orderTitle.replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pptx`;
  await pptx.writeFile({ fileName });
  onProgress(100, 'اكتمل التصدير بنجاح!');
  return true;
}
