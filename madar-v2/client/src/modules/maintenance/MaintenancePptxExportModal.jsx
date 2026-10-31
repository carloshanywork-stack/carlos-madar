import { useEffect, useMemo, useState } from 'react';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import { Select } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';

function statusLabel(status) {
  return ({ in_progress: 'قيد التنفيذ', review: 'بانتظار المراجعة', archived: 'مؤرشف' })[status] ?? status;
}

function downloadFile(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

function filenameFromDisposition(header, fallback) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* use the regular filename below */ }
  }
  return /filename="?([^";]+)"?/i.exec(header ?? '')?.[1] ?? fallback;
}

function requestPptxExport(payload, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams();
    for (const orderId of payload.orderIds ?? []) query.append('orderIds', String(orderId));
    if (payload.reasonId !== null && payload.reasonId !== undefined) query.set('reasonId', String(payload.reasonId));
    const queryString = query.toString();
    xhr.open('POST', `/api/maintenance/export/pptx${queryString ? `?${queryString}` : ''}`);
    xhr.withCredentials = true;
    xhr.responseType = 'blob';
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.addEventListener('progress', (event) => {
      onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null);
    });
    xhr.addEventListener('error', () => reject(new Error('تعذر الاتصال بالخادم أثناء إنشاء العرض.')));
    xhr.addEventListener('abort', () => reject(new Error('تم إلغاء إنشاء العرض.')));
    xhr.addEventListener('load', async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        const text = await xhr.response?.text?.().catch(() => '');
        let message = `تعذر إنشاء العرض (${xhr.status}).`;
        try { message = JSON.parse(text).error || message; } catch { /* response is not JSON */ }
        reject(new Error(message));
        return;
      }
      const fallback = 'Madar_Report_Maintenance.pptx';
      const filename = filenameFromDisposition(xhr.getResponseHeader('Content-Disposition'), fallback);
      resolve({ blob: xhr.response, filename });
    });
    xhr.send(JSON.stringify(payload));
  });
}

export default function MaintenancePptxExportModal({
  open,
  onClose,
  currentOrder = null,
  defaultScope = currentOrder ? 'current' : 'archive',
}) {
  const { data: inProgressOrders, loading: inProgressLoading } = useApi('/api/maintenance/orders?status=in_progress', { enabled: open });
  const { data: reviewOrders, loading: reviewLoading } = useApi('/api/maintenance/orders?status=review', { enabled: open });
  const { data: archivedOrders, loading: archivedLoading } = useApi('/api/maintenance/orders?status=archived', { enabled: open });
  const { data: reasons, loading: reasonsLoading, error: reasonsError } = useApi('/api/maintenance/reasons?includeInactive=true', { enabled: open });
  const [scope, setScope] = useState(defaultScope);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [reasonId, setReasonId] = useState('');
  const [area, setArea] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [showReasonFooter, setShowReasonFooter] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [error, setError] = useState('');
  const ordersLoading = inProgressLoading || reviewLoading || archivedLoading;
  const allOrders = useMemo(() => {
    const byId = new Map();
    for (const order of [...(archivedOrders ?? []), ...(reviewOrders ?? []), ...(inProgressOrders ?? []), ...(currentOrder ? [currentOrder] : [])]) {
      byId.set(order.id, order);
    }
    return [...byId.values()].sort((left, right) => String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')) || right.id - left.id);
  }, [archivedOrders, currentOrder, inProgressOrders, reviewOrders]);
  const areas = useMemo(() => [...new Set(allOrders.map((order) => order.area).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ar')), [allOrders]);

  useEffect(() => {
    if (!open) return;
    setScope(currentOrder ? defaultScope : 'archive');
    setSelectedOrderIds(currentOrder ? [currentOrder.id] : []);
    setReasonId('');
    setArea('');
    setGroupBy('none');
    setShowReasonFooter(false);
    setExporting(false);
    setDownloadProgress(null);
    setError('');
  }, [currentOrder?.id, defaultScope, open]);

  function toggleSelectedOrder(orderId) {
    setSelectedOrderIds((current) => current.includes(orderId)
      ? current.filter((id) => id !== orderId)
      : [...current, orderId]);
  }

  async function createExport(event) {
    event.preventDefault();
    setError('');
    let orderIds;
    if (scope === 'current') {
      if (!currentOrder?.id) {
        setError('افتح تفاصيل أمر صيانة لاستخدام نطاق الأمر الحالي.');
        return;
      }
      orderIds = [currentOrder.id];
    } else if (scope === 'archive') {
      orderIds = [];
    } else {
      orderIds = selectedOrderIds;
      if (!orderIds.length) {
        setError('حدد أمراً واحداً على الأقل لإنشاء التقرير.');
        return;
      }
    }

    setExporting(true);
    setDownloadProgress(null);
    try {
      const result = await requestPptxExport({
        orderIds,
        reasonId: reasonId ? Number(reasonId) : null,
        area: area || null,
        groupBy,
        showReasonFooter,
      }, setDownloadProgress);
      downloadFile(result.blob, result.filename);
      onClose?.();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExporting(false);
      setDownloadProgress(null);
    }
  }

  function close() {
    if (!exporting) onClose?.();
  }

  return (
    <Modal open={open} onClose={close} title="خيارات تصدير عرض PowerPoint" description="اختر نطاق الأوامر وتصنيف الشرائح قبل إنشاء التقرير." wide>
      <form className="madar-form-stack madar-pptx-export-form" onSubmit={createExport}>
        {error && <Alert tone="error">{error}</Alert>}
        {reasonsError && <Alert tone="error">تعذر تحميل أسباب الصيانة: {reasonsError}</Alert>}

        <fieldset className="madar-export-fieldset">
          <legend>نطاق الأوامر</legend>
          <div className="madar-export-scope-options">
            {currentOrder && <label className="madar-export-radio-option">
              <input type="radio" name="pptx-scope" value="current" checked={scope === 'current'} onChange={() => setScope('current')} />
              <span><strong>الأمر الحالي فقط</strong><small>{currentOrder.order_code} · {currentOrder.client_name}</small></span>
            </label>}
            <label className="madar-export-radio-option">
              <input type="radio" name="pptx-scope" value="archive" checked={scope === 'archive'} onChange={() => setScope('archive')} />
              <span><strong>كل الأرشيف</strong><small>يشمل أوامر الصيانة المؤرشفة المطابقة للفلاتر</small></span>
            </label>
            <label className="madar-export-radio-option">
              <input type="radio" name="pptx-scope" value="selected" checked={scope === 'selected'} onChange={() => setScope('selected')} />
              <span><strong>تحديد أوامر محددة</strong><small>اختر أكثر من أمر صيانة عند الحاجة</small></span>
            </label>
          </div>
          {scope === 'selected' && <div className="madar-export-order-picker" aria-label="الأوامر المتاحة للتحديد">
            {ordersLoading ? <LoadingState label="جارٍ تحميل أوامر الصيانة" /> : allOrders.length ? allOrders.map((order) => (
              <label className="madar-export-order-option" key={order.id}>
                <input className="madar-checkbox" type="checkbox" checked={selectedOrderIds.includes(order.id)} onChange={() => toggleSelectedOrder(order.id)} />
                <span className="madar-code">{order.order_code}</span>
                <strong>{order.client_name}</strong>
                <small>{order.area || 'منطقة غير محددة'} · {statusLabel(order.status)}</small>
              </label>
            )) : <p className="madar-muted madar-small">لا توجد أوامر متاحة.</p>}
          </div>}
        </fieldset>

        <div className="madar-export-filter-grid">
          <Select label="تصنيف وتصفية الأعطال" value={reasonId} disabled={reasonsLoading} onChange={(event) => setReasonId(event.target.value)}>
            <option value="">جميع الأعطال والأعمال (شامل)</option>
            {(reasons ?? []).map((reason) => <option key={reason.id} value={reason.id}>{reason.name}{reason.active ? '' : ' (معطّل)'}</option>)}
          </Select>
          <Select label="تصفية المنطقة" value={area} onChange={(event) => setArea(event.target.value)}>
            <option value="">كل المناطق</option>
            {areas.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>

        <fieldset className="madar-export-fieldset">
          <legend>ترتيب الشرائح</legend>
          <div className="madar-export-group-options">
            {[
              ['reason', 'تجميع حسب سبب الصيانة'],
              ['area', 'تجميع حسب المنطقة'],
              ['none', 'تسلسلي عادي'],
            ].map(([value, label]) => <label className="madar-export-radio-option madar-export-radio-inline" key={value}>
              <input type="radio" name="pptx-group-by" value={value} checked={groupBy === value} onChange={() => setGroupBy(value)} />
              <span><strong>{label}</strong></span>
            </label>)}
          </div>
          <label className="madar-export-radio-option madar-export-radio-inline madar-export-footer-option">
            <input type="checkbox" checked={showReasonFooter} onChange={(event) => setShowReasonFooter(event.target.checked)} />
            <span><strong>إظهار سبب الصيانة فقط كتذييل لشريحة الماكينة</strong><small>عند التفعيل ينتقل السبب من بيانات الشريحة إلى التذييل، مع بقاء التاريخ والملاحظات في محتوى الشريحة.</small></span>
          </label>
        </fieldset>

        {exporting && <div className="madar-export-progress" role="status" aria-live="polite">
          <span>{downloadProgress === null ? 'جارٍ إنشاء العرض وتجهيزه للتنزيل…' : `جارٍ تنزيل العرض (${downloadProgress}٪)`}</span>
          <progress value={downloadProgress ?? undefined} max="100" aria-label="تقدم إنشاء وتنزيل PowerPoint" />
        </div>}
        <div className="madar-form-actions">
          <Button variant="secondary" disabled={exporting} onClick={close}>إلغاء</Button>
          <Button type="submit" icon="presentation" disabled={exporting || reasonsLoading || (scope === 'selected' && (ordersLoading || !selectedOrderIds.length))}>
            {exporting ? 'جارٍ إنشاء العرض…' : 'إنشاء وتنزيل ملف PowerPoint'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
