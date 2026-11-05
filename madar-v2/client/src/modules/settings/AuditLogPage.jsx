import { useMemo, useState } from 'react';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useApi } from '../../lib/useApi.js';

const ACTION_LABELS = {
  create: 'إنشاء', update: 'تعديل', delete: 'حذف', login: 'دخول', archive: 'أرشفة',
  purchase_invoice: 'شراء نقدي', create_sales_invoice: 'فاتورة بيع نقدية',
  sales_receipt: 'سند قبض', purchase_invoice_revision: 'تعديل فاتورة شراء',
  ready: 'تجهيز الورشة', delivered_archive: 'تسليم الورشة', design_upload: 'رفع تصميم',
  start: 'بدء جرد', reconcile: 'تسوية جرد',
};

const ENTITY_LABELS = {
  maintenance_card: 'كارت صيانة', maintenance_order: 'أمر صيانة', workshop_order: 'أمر ورشة',
  invoice: 'فاتورة', user: 'مستخدم', employee: 'موظف', client: 'عميل',
  treasury_entry: 'حركة خزينة', stock_count: 'جرد مخزون', material: 'خامة',
};

const ROLE_LABELS = {
  admin: 'مدير النظام', finance: 'مالية', accountant: 'محاسب', sales: 'مبيعات',
  operations: 'عمليات', purchasing: 'مشتريات', rep: 'مندوب ميداني',
};

function cairoTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo',
  }).format(date);
}

function valueText(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value !== 'object') return String(value);
  return JSON.stringify(value, null, 2);
}

function valueEntries(value) {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return [['القيمة', value]];
  return Object.entries(value);
}

function AuditDetails({ record }) {
  const oldEntries = valueEntries(record.oldValues);
  const newEntries = valueEntries(record.newValues);
  const keys = [...new Set([...oldEntries.map(([key]) => key), ...newEntries.map(([key]) => key)])];
  const oldByKey = new Map(oldEntries);
  const newByKey = new Map(newEntries);
  if (!keys.length) return <p className="madar-muted">لا توجد تفاصيل محفوظة لهذه العملية.</p>;
  return (
    <div className="madar-table-wrap">
      <table className="madar-table">
        <thead><tr><th>الحقل</th><th>القيمة السابقة</th><th>القيمة الجديدة</th></tr></thead>
        <tbody>{keys.map((key) => (
          <tr key={key}>
            <th>{key}</th>
            <td><pre className="madar-audit-value">{valueText(oldByKey.get(key))}</pre></td>
            <td><pre className="madar-audit-value">{valueText(newByKey.get(key))}</pre></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState(null);
  const path = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), limit: '50' });
    if (action) query.set('action', action);
    if (actorId) query.set('actorId', actorId);
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);
    return `/api/system/audit-log?${query.toString()}`;
  }, [action, actorId, endDate, page, startDate]);
  const { data, loading, error, reload } = useApi(path);
  const rows = data?.items ?? [];

  function resetPage(update) {
    update();
    setPage(1);
  }

  return (
    <section className="madar-section" aria-label="سجل العمليات والرقابة">
      <div className="madar-panel madar-section">
        <div className="madar-panel-header">
          <div><h2>سجل العمليات والرقابة</h2><p>سجل تدقيقي للإنشاء والتعديل والحذف والدخول والأرشفة، مع القيم السابقة والجديدة.</p></div>
          <Button variant="secondary" size="small" icon="refresh" disabled={loading} onClick={reload}>تحديث</Button>
        </div>
        <div className="madar-panel-body">
          <div className="madar-form-grid">
            <Input label="نوع العملية (اختياري)" value={action} maxLength={100}
              placeholder="مثل: update أو purchase_invoice"
              onChange={(event) => resetPage(() => setAction(event.target.value.trim()))} />
            <Input label="رقم المستخدم المنفذ (اختياري)" type="number" min="1" step="1" value={actorId}
              onChange={(event) => resetPage(() => setActorId(event.target.value))} />
            <Input label="من تاريخ · القاهرة" type="date" value={startDate}
              onChange={(event) => resetPage(() => setStartDate(event.target.value))} />
            <Input label="إلى تاريخ · القاهرة" type="date" value={endDate}
              onChange={(event) => resetPage(() => setEndDate(event.target.value))} />
          </div>
        </div>
        {error && <div className="madar-panel-body"><Alert tone="error">{error}</Alert></div>}
      </div>

      {loading && !data ? <LoadingState label="جارٍ تحميل سجل العمليات" /> : rows.length ? (
        <div className="madar-panel madar-section">
          <div className="madar-panel-header"><div><strong>{Number(data.total).toLocaleString('ar-EG')} عملية</strong><p>صفحة {data.page} من {data.pages || 1}</p></div></div>
          <div className="madar-table-wrap"><table className="madar-table">
            <thead><tr><th>وقت العملية · القاهرة</th><th>المنفذ</th><th>نوع العملية</th><th>العنصر المتأثر</th><th>التفاصيل</th></tr></thead>
            <tbody>{rows.map((record) => (
              <tr key={record.id}>
                <td>{cairoTimestamp(record.timestamp)}</td>
                <td><strong>{record.actorName || 'مستخدم غير متاح'}</strong><small className="madar-small madar-muted">{record.actorUsername ? ` · ${record.actorUsername}` : ''}{record.actorRole ? ` · ${ROLE_LABELS[record.actorRole] ?? record.actorRole}` : ''}</small></td>
                <td><Badge tone={record.action === 'delete' ? 'danger' : record.action === 'login' ? 'info' : 'neutral'}>{ACTION_LABELS[record.action] ?? record.action}</Badge></td>
                <td>{ENTITY_LABELS[record.entityType] ?? record.entityType} <span className="madar-code">#{record.entityId}</span></td>
                <td><Button size="small" variant="secondary" onClick={() => setSelected(record)}>عرض التفاصيل</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="madar-form-actions">
            <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</Button>
            <Button variant="secondary" disabled={page >= (data?.pages ?? 0) || loading} onClick={() => setPage((value) => value + 1)}>التالي</Button>
          </div>
        </div>
      ) : !error && <EmptyState icon="file" title="لا توجد عمليات مطابقة" description="غيّر مرشحات العملية أو التاريخ لعرض نتائج أخرى." />}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="تفاصيل العملية" description={selected ? `${cairoTimestamp(selected.timestamp)} · ${ACTION_LABELS[selected.action] ?? selected.action} · ${ENTITY_LABELS[selected.entityType] ?? selected.entityType} #${selected.entityId}` : ''} wide>
        {selected && <div className="madar-stack">
          <p><strong>المنفذ:</strong> {selected.actorName || 'مستخدم غير متاح'}{selected.actorUsername ? ` · ${selected.actorUsername}` : ''}{selected.actorRole ? ` · ${ROLE_LABELS[selected.actorRole] ?? selected.actorRole}` : ''}</p>
          <AuditDetails record={selected} />
        </div>}
      </Modal>
    </section>
  );
}
