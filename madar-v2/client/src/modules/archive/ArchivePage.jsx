import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { errorMessage, formatDate } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';

export default function ArchivePage() {
  const [tab, setTab] = useState('maintenance');
  const { data: maintenance, loading: maintenanceLoading, error: maintenanceError } = useApi('/api/maintenance/orders?status=archived');
  const { data: workshop, loading: workshopLoading, error: workshopError } = useApi('/api/workshop/orders?status=delivered_archived');
  const [reportOrder, setReportOrder] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const orders = tab === 'maintenance' ? maintenance : workshop;
  const loading = tab === 'maintenance' ? maintenanceLoading : workshopLoading;
  const error = tab === 'maintenance' ? maintenanceError : workshopError;

  async function openPhotoReport(order) {
    setReportOrder(order);
    setReport(null);
    setReportError('');
    setReportLoading(true);
    try { setReport(await api.get(`/api/maintenance/orders/${order.id}`)); }
    catch (caught) { setReportError(errorMessage(caught)); }
    finally { setReportLoading(false); }
  }

  return (
    <>
      <PageHeader kicker="الأعمال المكتملة · السجل التاريخي" title="الأرشيف والتقارير" description="تصفح أوامر الصيانة المؤرشفة وأوامر الورشة المسلّمة دون تعديل السجلات التاريخية." />
      <div className="madar-integration-notice"><Alert tone="info">تتوفر الآن معاينة قابلة للطباعة لصور الصيانة المؤرشفة. إنشاء ملفات PPTX أو Word غير متاح لأن خادم V2 لا يوفّر واجهة تصدير تقارير بعد.</Alert></div>
      <div className="madar-section"><Tabs items={[{ value: 'maintenance', label: 'أرشيف الصيانة', count: maintenance?.length }, { value: 'workshop', label: 'أوامر الورشة المسلّمة', count: workshop?.length }]} value={tab} onChange={setTab} ariaLabel="أقسام الأرشيف" /></div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      <section className="madar-panel madar-section">
        {loading ? <LoadingState label="جارٍ تحميل الأرشيف" /> : orders?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>رقم الأمر</th><th>العميل</th><th>{tab === 'maintenance' ? 'الآلات' : 'المنتج'}</th><th>تاريخ الإغلاق</th><th>الحالة</th><th>عرض</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td className="madar-code">{order.order_code}</td><td>{order.client_name}</td><td>{tab === 'maintenance' ? order.card_count : order.product_name}</td><td>{formatDate(order.archived_at ?? order.delivered_at)}</td><td><Badge status={order.status} /></td><td>{tab === 'maintenance' ? <Button size="small" variant="secondary" icon="image" onClick={() => openPhotoReport(order)}>معاينة الصور</Button> : <Link className="madar-button madar-button-secondary madar-button-small" to={`/workshop/${order.id}`}>تفاصيل الأمر <Icon name="chevron" size={12} /></Link>}</td></tr>)}</tbody></table></div> : <EmptyState icon="archive" title="لا توجد سجلات مؤرشفة" description="ستظهر هنا الطلبات المكتملة مع الاحتفاظ بسجلها التاريخي." />}
      </section>
      <Modal open={reportOrder !== null} onClose={() => setReportOrder(null)} title="معاينة تقرير الصيانة" description={reportOrder ? `${reportOrder.order_code} · ${reportOrder.client_name}` : ''} wide>
        <div className="madar-report-actions"><Alert tone="info">يمكنك طباعة هذه المعاينة أو اختيار “حفظ كـ PDF” من نافذة الطباعة.</Alert><Button icon="printer" variant="secondary" onClick={() => window.print()} disabled={!report}>طباعة / حفظ PDF</Button></div>
        {reportLoading ? <LoadingState label="جارٍ تجهيز معاينة الصور" /> : reportError ? <Alert tone="error">{reportError}</Alert> : report && <div className="madar-print-report">
          <div className="madar-report-heading"><div className="madar-report-wordmark">MADAR</div><div><span>تقرير صيانة ميدانية</span><h2>{report.client?.name}</h2><p>{report.order_code} · {report.archived_at?.slice(0, 10)}</p></div></div>
          {report.cards.map((card) => <section className="madar-report-machine" key={card.id}><h3>{card.machine_name_ar} · {card.machine_code}</h3><p>{card.machine_area}</p><div className="madar-report-photo-columns"><ReportPhotoColumn title="قبل الصيانة" urls={card.before_photo_urls} /><ReportPhotoColumn title="بعد الصيانة" urls={card.after_photo_urls} /></div></section>)}
          {!report.cards.length && <EmptyState icon="image" title="لا توجد صور مرتبطة" />}
        </div>}
      </Modal>
    </>
  );
}

function ReportPhotoColumn({ title, urls }) {
  return <div><h4>{title}</h4>{urls.length ? <div className="madar-report-photos">{urls.map((url, index) => <img src={url} key={`${url}-${index}`} alt={`${title} ${index + 1}`} />)}</div> : <p className="madar-muted madar-small">لا توجد صور</p>}</div>;
}
