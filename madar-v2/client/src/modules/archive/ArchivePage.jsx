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
import MaintenanceAreaAnalysis from './MaintenanceAreaAnalysis.jsx';
import MaintenancePptxExportModal from '../maintenance/MaintenancePptxExportModal.jsx';
import { Input } from '../../components/ui/Field.jsx';

export default function ArchivePage({ isAdmin = false }) {
  const [tab, setTab] = useState('maintenance');
  const [month, setMonth] = useState('');
  const monthQuery = month ? `&month=${encodeURIComponent(month)}` : '';
  const { data: maintenance, loading: maintenanceLoading, error: maintenanceError, reload: reloadMaintenance } = useApi(`/api/maintenance/orders?status=archived${monthQuery}`);
  const { data: workshop, loading: workshopLoading, error: workshopError, reload: reloadWorkshop } = useApi(`/api/workshop/orders?status=delivered_archived${monthQuery}`);
  const [monthOrder, setMonthOrder] = useState(null);
  const [monthDraft, setMonthDraft] = useState('');
  const [monthSaving, setMonthSaving] = useState(false);
  const [monthError, setMonthError] = useState('');
  const [reportOrder, setReportOrder] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [pptxExportOpen, setPptxExportOpen] = useState(false);
  const [pptxExportOrder, setPptxExportOrder] = useState(null);
  const orders = tab === 'maintenance' ? maintenance : tab === 'workshop' ? workshop : [];
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

  function openPptxExport(order = null) {
    setPptxExportOrder(order);
    setPptxExportOpen(true);
  }

  async function saveMonth(event) {
    event.preventDefault();
    setMonthSaving(true); setMonthError('');
    try {
      await api.patch(`/api/${monthOrder.kind}/orders/${monthOrder.id}/archive-month`, { archiveMonth: monthDraft || null });
      await (monthOrder.kind === 'maintenance' ? reloadMaintenance() : reloadWorkshop());
      setMonthOrder(null);
    } catch (caught) { setMonthError(errorMessage(caught)); }
    finally { setMonthSaving(false); }
  }

  return (
    <>
      <PageHeader kicker="الأعمال المكتملة · السجل التاريخي" title="الأرشيف والتقارير" description="تصفح أوامر الصيانة المؤرشفة وأوامر الورشة المسلّمة مع الاحتفاظ بسجلها وملفاتها." actions={tab === 'maintenance' && <Button icon="presentation" onClick={() => openPptxExport()}>تصدير تقرير PowerPoint</Button>} />
      <div className="madar-integration-notice"><Alert tone="info">يمكن تنزيل تقارير الصيانة المؤرشفة بصيغ PowerPoint وWord، أو طباعة المعاينة وحفظها PDF.</Alert></div>
      <section className="madar-panel madar-panel-pad madar-section">
        <div className="madar-inline-wrap">
          <Input label="شهر الأرشيف · اتركه فارغاً لعرض كل الشهور" type="month" value={month === 'unassigned' ? '' : month} disabled={month === 'unassigned'} onChange={(event) => setMonth(event.target.value)} />
          <label><input type="checkbox" checked={month === 'unassigned'} onChange={(event) => setMonth(event.target.checked ? 'unassigned' : '')} /> غير محدد الشهر</label>
          {month && <Button variant="secondary" onClick={() => setMonth('')}>كل الشهور</Button>}
        </div>
        <p className="madar-small madar-muted">شهر الأرشيف تحدده الإدارة لكل أمر، ويُستخدم في التحليل والتقارير. الأوامر القديمة تظل غير محددة حتى تختار شهرها.</p>
      </section>
      <div className="madar-section"><Tabs items={[
        { value: 'maintenance', label: 'أرشيف الصيانة', count: maintenance?.length },
        { value: 'workshop', label: 'أوامر الورشة المسلّمة', count: workshop?.length },
        { value: 'analysis', label: 'تحليل الأرشيف والمناطق (Archive & Area Analysis)' },
      ]} value={tab} onChange={setTab} ariaLabel="أقسام الأرشيف" /></div>
      {tab === 'analysis' ? <MaintenanceAreaAnalysis month={month} /> : <>
        {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
        <section className="madar-panel madar-section">
          {loading ? <LoadingState label="جارٍ تحميل الأرشيف" /> : orders?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>رقم الأمر</th><th>العميل</th>{tab === 'maintenance' && <th>المناطق</th>}<th>{tab === 'maintenance' ? 'الآلات' : 'المنتج'}</th><th>تاريخ الإغلاق</th><th>شهر الأرشيف</th><th>الحالة</th><th>عرض / تصدير</th></tr></thead><tbody>{orders.map((order) => {
            const areas = order.areas?.length ? order.areas : order.area ? [order.area] : [];
            return <tr key={order.id}>
              <td className="madar-code">{order.order_code}</td>
              <td>{order.client_name}</td>
              {tab === 'maintenance' && <td>{areas.length ? <div className="madar-inline-wrap" style={{ gap: '4px', maxWidth: '280px', flexWrap: 'wrap' }}>
                {areas.map((areaName) => <span key={areaName} className="madar-badge madar-badge-info" style={{
                  fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', fontWeight: 600,
                }}>{areaName}</span>)}
              </div> : <span className="madar-muted">—</span>}</td>}
              <td>{tab === 'maintenance' ? order.card_count : order.product_name}</td>
              <td>{formatDate(order.archived_at ?? order.delivered_at)}</td>
              <td><span>{order.archive_month || 'غير محدد الشهر'}</span>{isAdmin && <Button size="small" variant="secondary" onClick={() => { setMonthOrder({ ...order, kind: tab }); setMonthDraft(order.archive_month || ''); setMonthError(''); }}>تحديد الشهر</Button>}</td>
              <td><Badge status={order.status} /></td>
              <td>{tab === 'maintenance' ? <div className="madar-inline-wrap"><Button size="small" variant="secondary" icon="image" onClick={() => openPhotoReport(order)}>معاينة</Button><Button size="small" variant="primary" icon="presentation" onClick={() => openPptxExport(order)}>تصدير PowerPoint</Button><Button size="small" variant="secondary" icon="file" onClick={() => { window.location.href = `/api/maintenance/orders/${order.id}/export.docx`; }}>Word</Button></div> : <Link className="madar-button madar-button-secondary madar-button-small" to={`/workshop/${order.id}`}>تفاصيل الأمر <Icon name="chevron" size={12} /></Link>}</td>
            </tr>;
          })}</tbody></table></div> : <EmptyState icon="archive" title="لا توجد سجلات مؤرشفة" description="ستظهر هنا الطلبات المكتملة مع الاحتفاظ بسجلها التاريخي." />}
        </section>
      </>}
      <Modal open={reportOrder !== null} onClose={() => setReportOrder(null)} title="معاينة تقرير الصيانة" description={reportOrder ? `${reportOrder.order_code} · ${reportOrder.client_name}` : ''} wide>
        <div className="madar-report-actions"><Alert tone="info">يمكنك طباعة هذه المعاينة أو اختيار “حفظ كـ PDF” من نافذة الطباعة.</Alert><Button icon="printer" variant="secondary" onClick={() => window.print()} disabled={!report}>طباعة / حفظ PDF</Button></div>
        {reportLoading ? <LoadingState label="جارٍ تجهيز معاينة الصور" /> : reportError ? <Alert tone="error">{reportError}</Alert> : report && <div className="madar-print-report">
          <div className="madar-report-heading"><div className="madar-report-wordmark">MADAR</div><div><span>تقرير صيانة ميدانية</span><h2>{report.client?.name}</h2><p>{report.order_code} · شهر الأرشيف: {report.archive_month || 'غير محدد الشهر'}</p></div></div>
          {report.cards.map((card) => <section className="madar-report-machine" key={card.id}><h3>{card.machine_name_ar} · {card.machine_code}</h3><p>{card.machine_area}</p><div className="madar-report-photo-columns"><ReportPhotoColumn title="قبل الصيانة" urls={card.before_photo_urls} /><ReportPhotoColumn title="بعد الصيانة" urls={card.after_photo_urls} /></div></section>)}
          {!report.cards.length && <EmptyState icon="image" title="لا توجد صور مرتبطة" />}
        </div>}
      </Modal>
      <Modal open={monthOrder !== null} onClose={() => !monthSaving && setMonthOrder(null)} title="تحديد شهر الأرشيف" description={monthOrder?.order_code || ''}>
        <form onSubmit={saveMonth}><Input label="شهر وسنة الأرشيف" type="month" value={monthDraft} onChange={(event) => setMonthDraft(event.target.value)} /><p className="madar-small madar-muted">اترك الشهر فارغاً لإعادته إلى غير محدد. لا يغيّر ذلك تاريخ الإغلاق أو التسوية المالية.</p>{monthError && <Alert tone="error">{monthError}</Alert>}<Button type="submit" disabled={monthSaving}>{monthSaving ? 'جارٍ الحفظ…' : 'حفظ الشهر'}</Button></form>
      </Modal>
      <MaintenancePptxExportModal
        open={pptxExportOpen}
        onClose={() => setPptxExportOpen(false)}
        currentOrder={pptxExportOrder}
        defaultScope={pptxExportOrder ? 'current' : 'archive'}
        archiveMonthFilter={month}
      />
    </>
  );
}

function ReportPhotoColumn({ title, urls }) {
  return <div><h4>{title}</h4>{urls.length ? <div className="madar-report-photos">{urls.map((url, index) => <img src={url} key={`${url}-${index}`} alt={`${title} ${index + 1}`} />)}</div> : <p className="madar-muted madar-small">لا توجد صور</p>}</div>;
}
