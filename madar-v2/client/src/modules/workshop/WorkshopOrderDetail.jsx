import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { errorMessage, formatDate, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Toast from '../../components/ui/Toast.jsx';

export default function WorkshopOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: order, loading, error, reload } = useApi(`/api/workshop/orders/${id}`);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { notice, showToast, clearToast } = useToast();

  const uploadDesign = useCallback(async (files) => {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setSaving(true);
    try {
      await api.upload(`/api/workshop/orders/${id}/designs`, form);
      await reload();
      showToast('تم رفع ملف التصميم المتجهي.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }, [id, reload, showToast]);

  async function markReady() {
    setSaving(true);
    try {
      await api.post(`/api/workshop/orders/${id}/ready`, { offcuts: [] });
      await reload();
      showToast('تم تحويل الأمر إلى جاهز للتسليم.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function deliver() {
    if (!window.confirm(`تأكيد تسليم ${order.order_code}؟ سيتم إنشاء فاتورة بيع.`)) return;
    setSaving(true);
    try {
      const result = await api.post(`/api/workshop/orders/${id}/deliver`, {});
      await reload();
      showToast(`تم التسليم وإنشاء الفاتورة ${result.invoice.code}.`);
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  if (loading && !order) return <LoadingState label="جارٍ تحميل أمر الورشة" />;
  if (error) return <><PageHeader title="أمر الورشة" actions={<Button variant="secondary" onClick={() => navigate('/workshop')}>العودة للقائمة</Button>} /><Alert tone="error">{error}</Alert></>;

  return (
    <>
      <PageHeader kicker="تفاصيل الإنتاج" title={order.order_code} description="مواصفات المنتج وملفات التصميم ومسار التسليم." actions={<Button variant="secondary" icon="arrow" onClick={() => navigate('/workshop')}>كل أوامر الورشة</Button>} />
      <section className="madar-panel madar-order-hero">
        <div>
          <div className="madar-inline"><h2 className="madar-order-client">{order.product_name}</h2><Badge status={order.status} /></div>
          <div className="madar-order-meta">
            <span>العميل <strong>{order.client?.name}</strong></span><span>الآلة <strong>{order.machine_type}</strong></span>
            <span>موعد التسليم <strong>{formatDate(order.target_delivery_date)}</strong></span><span>السعر <strong className="madar-money">{formatMoney(order.sale_price_cents)}</strong></span>
            <span>الفنيون <strong>{order.technicians.map((item) => item.name).join('، ') || 'غير معيّنين'}</strong></span>
          </div>
          {order.description && <p className="madar-order-notes">{order.description}</p>}
        </div>
        <div className="madar-inline-wrap">
          {order.status === 'in_production' && <Button icon="check" disabled={saving} onClick={markReady}>جاهز للتسليم</Button>}
          {order.status === 'ready' && <Button icon="arrow" disabled={saving} onClick={deliver}>تسليم وإنشاء فاتورة</Button>}
        </div>
      </section>
      {order.salesInvoice && <div className="madar-alert madar-alert-success madar-section"><Icon name="file" size={15} /> فاتورة البيع <strong className="madar-code">{order.salesInvoice.code}</strong> · {formatMoney(order.salesInvoice.total_cents)} · <Badge status={order.salesInvoice.payment_status} /></div>}

      <section className="madar-panel madar-section">
        <div className="madar-panel-header"><div><h2>ملفات التصميم المتجهي</h2><p>ملفات جاهزة للتنزيل لمشغلي CNC وLaser · DXF, CDR, AI, PDF</p></div>{order.status !== 'delivered_archived' && <span className="madar-badge madar-badge-info">حد أقصى 40 MB</span>}</div>
        <div className="madar-panel-body madar-stack">
          {order.designFiles.length ? <div className="madar-file-list">{order.designFiles.map((file) => (
            <a className="madar-file-link" href={file.download_url} key={file.id}><span className="madar-file-type">{file.extension.slice(1).toUpperCase()}</span><span className="madar-file-copy"><strong>{file.original_name}</strong><small>{(file.byte_size / 1024 / 1024).toFixed(2)} MB · {formatDate(file.created_at)}</small></span><Icon name="download" size={15} /></a>
          ))}</div> : <EmptyState icon="file" title="لا توجد ملفات تصميم" description="ارفع ملف الرسم المتجهي المرتبط بهذا الأمر." />}
          {order.status !== 'delivered_archived' && <label className={`madar-upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); uploadDesign(event.dataTransfer.files); }}>
            <input className="madar-visually-hidden" type="file" accept=".dxf,.cdr,.ai,.pdf,application/pdf" onChange={(event) => { uploadDesign(event.target.files); event.target.value = ''; }} disabled={saving} />
            <span><Icon name="upload" size={22} /><strong>{saving ? 'جارٍ رفع الملف…' : 'اسحب ملف التصميم هنا أو اختر ملفاً'}</strong><small>الامتدادات المسموحة: .dxf · .cdr · .ai · .pdf</small></span>
          </label>}
        </div>
      </section>

      {order.materialConsumption?.length > 0 && <section className="madar-panel madar-section"><div className="madar-panel-header"><div><h2>حركة المواد المرتبطة</h2><p>مصدر الصرف ومخزون الورشة</p></div></div><div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>المادة</th><th>المخزن</th><th>المرجع</th><th>التاريخ</th></tr></thead><tbody>{order.materialConsumption.map((movement) => <tr key={movement.id}><td>{movement.material_name} · {movement.material_code ?? ''}</td><td>{movement.warehouse === 'main' ? 'رئيسي' : 'ثانوي'}</td><td className="madar-code">{movement.reference}</td><td>{formatDate(movement.created_at)}</td></tr>)}</tbody></table></div></section>}
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
