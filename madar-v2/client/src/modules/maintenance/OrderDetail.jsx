import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Toast from '../../components/ui/Toast.jsx';

export default function MaintenanceOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: order, loading, error, reload } = useApi(`/api/maintenance/orders/${id}`);
  const { data: machines } = useApi('/api/maintenance/machines');
  const [cardOpen, setCardOpen] = useState(false);
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [custodyError, setCustodyError] = useState('');
  const { notice, showToast, clearToast } = useToast();
  const areas = useMemo(() => [...new Set((order?.cards ?? []).map((card) => card.machine_area).filter(Boolean))], [order]);

  const transitionToReview = useCallback(async () => {
    setSaving(true);
    setActionError('');
    try {
      await api.patch(`/api/maintenance/orders/${id}/status`, {});
      await reload();
      showToast('تم تحويل الأمر إلى المراجعة.');
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally { setSaving(false); }
  }, [id, reload, showToast]);

  async function addInspectionCard(event) {
    event.preventDefault();
    setSaving(true);
    setActionError('');
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/api/maintenance/orders/${id}/cards`, {
        machineId: Number(form.get('machineId')),
        notes: form.get('notes') || undefined,
      });
      setCardOpen(false);
      await reload();
      showToast('أُضيفت بطاقة فحص الآلة.');
    } catch (caught) { setActionError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function uploadPhotos(card, phase, event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    const existing = phase === 'before' ? card.before_photos.length : card.after_photos.length;
    if (files.length < 2 || files.length > 4 || files.length + existing > 4) {
      showToast('اختر من صورتين إلى أربع صور، وبحد أقصى أربع صور لكل مرحلة.', 'error');
      return;
    }
    setSaving(true);
    try {
      for (const file of files) {
        const data = new FormData();
        data.append('photo', file);
        await api.upload(`/api/maintenance/orders/${id}/cards/${card.id}/photos/${phase}`, data);
      }
      await reload();
      showToast(`تم رفع صور ${phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}.`);
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function archiveOrder(event) {
    event.preventDefault();
    setSaving(true);
    setExpenseError('');
    const form = new FormData(event.currentTarget);
    try {
      const actualExpensesCents = egpToCents(form.get('actualExpenses'), { allowZero: true });
      if (actualExpensesCents > order.petty_cash_disbursed_cents) {
        throw new Error('المصروف الفعلي لا يمكن أن يتجاوز العهدة المصروفة لهذا الأمر.');
      }
      await api.post(`/api/maintenance/orders/${id}/archive`, {
        actualExpensesCents,
        warrantyPeriodMonths: Number(form.get('warrantyPeriodMonths')),
      });
      setArchiveOpen(false);
      await reload();
      showToast('تمت أرشفة أمر الصيانة وتسوية العهدة.');
    } catch (caught) { setExpenseError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function advanceCustody(event) {
    event.preventDefault();
    setSaving(true);
    setCustodyError('');
    const form = new FormData(event.currentTarget);
    try {
      const amountCents = egpToCents(form.get('amount'), { allowZero: false });
      await api.post(`/api/maintenance/orders/${id}/custody-advance`, {
        amountCents,
        notes: form.get('notes') || undefined,
      });
      setCustodyOpen(false);
      await reload();
      showToast('تم صرف العهدة وربطها بأمر الصيانة.');
    } catch (caught) {
      setCustodyError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !order) return <LoadingState label="جارٍ تحميل أمر الصيانة" />;
  if (error) return <><PageHeader title="أمر الصيانة" actions={<Button variant="secondary" onClick={() => navigate('/maintenance')}>العودة للقائمة</Button>} /><Alert tone="error">{error}</Alert></>;

  return (
    <>
      <PageHeader kicker="تفاصيل الزيارة الميدانية" title={order.order_code} description="بطاقات فحص الآلات وتوثيق حالة ما قبل الخدمة وما بعدها." actions={<Button variant="secondary" icon="arrow" onClick={() => navigate('/maintenance')}>كل أوامر الصيانة</Button>} />
      <section className="madar-panel madar-order-hero">
        <div>
          <div className="madar-inline"><h2 className="madar-order-client">{order.client_name}</h2><Badge status={order.status} /></div>
          <div className="madar-order-meta">
            <span>المناطق <strong>{areas.join('، ') || 'لم تُحدد بعد'}</strong></span>
            <span>الآلات <strong>{order.cards.length}</strong></span>
            <span>الفنيون <strong>{order.technicians.map((technician) => technician.name).join('، ') || 'غير معيّنين'}</strong></span>
            <span>تاريخ الإنشاء <strong>{order.created_at?.slice(0, 10)}</strong></span>
          </div>
          {order.notes && <p className="madar-order-notes">{order.notes}</p>}
        </div>
        <div className="madar-inline-wrap">
          {order.status === 'in_progress' && <Button variant="secondary" icon="plus" onClick={() => { setActionError(''); setCardOpen(true); }}>إضافة آلة للفحص</Button>}
          {order.status === 'in_progress' && <Button variant="secondary" icon="wallet" onClick={() => { setCustodyError(''); setCustodyOpen(true); }}>صرف عهدة</Button>}
          {order.status === 'in_progress' && <Button icon="check" disabled={saving} onClick={transitionToReview}>إرسال للمراجعة</Button>}
          {order.status === 'review' && <Button icon="archive" onClick={() => { setExpenseError(''); setArchiveOpen(true); }}>أرشفة وتسوية العهدة</Button>}
        </div>
      </section>
      {actionError && <div className="madar-section"><Alert tone="error">{actionError}</Alert></div>}
      <div className="madar-section-head madar-section"><div><h2 className="madar-section-title">بطاقات فحص الآلات</h2><div className="madar-section-note">صور قبل وبعد الصيانة منفصلة لكل آلة</div></div><span className="madar-badge">{order.cards.length} بطاقة</span></div>
      {order.cards.length ? <div className="madar-maintenance-cards">
        {order.cards.map((card) => (
          <section className="madar-panel madar-inspection-card" key={card.id}>
            <div className="madar-panel-header">
              <div><h3>{card.machine_name_ar}{card.machine_name_en ? ` · ${card.machine_name_en}` : ''}</h3><p><span className="madar-code">{card.machine_code}</span> · {card.machine_area}</p></div>
              <Badge status={card.status} />
            </div>
            <div className="madar-panel-body">
              {card.notes && <p className="madar-card-notes">{card.notes}</p>}
              <div className="madar-grid madar-grid-2">
                <PhotoPhase title="قبل الصيانة" phase="before" urls={card.before_photo_urls} disabled={order.status === 'archived' || saving} onUpload={(event) => uploadPhotos(card, 'before', event)} />
                <PhotoPhase title="بعد الصيانة" phase="after" urls={card.after_photo_urls} disabled={order.status === 'archived' || saving} onUpload={(event) => uploadPhotos(card, 'after', event)} />
              </div>
            </div>
          </section>
        ))}
      </div> : <div className="madar-panel"><EmptyState icon="image" title="لم تُضف آلات للفحص" description="أضف بطاقة لكل آلة من التفاصيل، ثم ارفع صور قبل وبعد الخدمة." action={order.status === 'in_progress' && <Button icon="plus" onClick={() => setCardOpen(true)}>إضافة آلة للفحص</Button>} /></div>}

      {order.status === 'archived' && <section className="madar-panel madar-panel-pad madar-section"><h3 className="madar-section-title">ملخص تسوية العهدة</h3><div className="madar-settlement-row"><span>العهدة المصروفة</span><strong>{formatMoney(order.petty_cash_disbursed_cents)}</strong><span>المصروف الفعلي</span><strong>{formatMoney(order.actual_expenses_cents)}</strong><span>المبلغ المعاد للخزينة</span><strong className="madar-money">{formatMoney(order.petty_cash_refund_cents)}</strong></div><div className="madar-small madar-muted">فترة الضمان: {order.warranty_period_months} أشهر</div></section>}

      <Modal open={cardOpen} onClose={() => setCardOpen(false)} title="إضافة آلة للفحص" description="يتم ربط الآلة تلقائياً بملف العميل كموقع خدمة.">
        <form onSubmit={addInspectionCard}>
          <div className="madar-form-stack">
            <Select label="الآلة *" name="machineId" required defaultValue=""><option value="" disabled>اختر الآلة</option>{(machines ?? []).map((machine) => <option key={machine.id} value={machine.id}>{machine.code} · {machine.name_ar} · {machine.area}</option>)}</Select>
            <Textarea label="ملاحظات فنية داخلية" name="notes" maxLength={10000} />
          </div>
          {actionError && <div className="madar-form-error"><Alert tone="error">{actionError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCardOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving || !machines?.length}>{saving ? 'جارٍ الحفظ…' : 'إضافة البطاقة'}</Button></div>
        </form>
      </Modal>

      <Modal open={custodyOpen} onClose={() => setCustodyOpen(false)} title="صرف عهدة لأمر الصيانة" description="يُسجل الصرف كمصروف خزينة مرتبط بهذا الأمر، ويُسوى الرصيد عند الأرشفة.">
        <form onSubmit={advanceCustody}>
          <div className="madar-form-stack">
            <div className="madar-receipt-due"><span>إجمالي العهدة الحالية</span><strong className="madar-money">{formatMoney(order.petty_cash_disbursed_cents)}</strong></div>
            <Input label="مبلغ العهدة الجديدة (جنيه) *" name="amount" type="text" inputMode="decimal" required placeholder="0.00" />
            <Textarea label="ملاحظات الصرف" name="notes" maxLength={2000} />
          </div>
          {custodyError && <div className="madar-form-error"><Alert tone="error">{custodyError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setCustodyOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ تسجيل الصرف…' : 'تأكيد صرف العهدة'}</Button></div>
        </form>
      </Modal>

      <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="أرشفة أمر الصيانة" description="حدد المصروف الفعلي وفترة الضمان. سيُعاد أي فائض عهدة إلى الخزينة تلقائياً.">
        <form onSubmit={archiveOrder}>
          <div className="madar-form-stack">
            <Alert tone="info">العهدة المسجلة: {formatMoney(order.petty_cash_disbursed_cents)}. لا يمكن أن يتجاوز المصروف الفعلي هذا المبلغ.</Alert>
            <Input label="المصروف الفعلي (جنيه)" name="actualExpenses" type="text" inputMode="decimal" required defaultValue="0.00" hint="أدخل المبلغ حتى منزلتين عشريتين." />
            <Select label="فترة الضمان *" name="warrantyPeriodMonths" required defaultValue="3"><option value="3">3 أشهر</option><option value="6">6 أشهر</option></Select>
          </div>
          {expenseError && <div className="madar-form-error"><Alert tone="error">{expenseError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setArchiveOpen(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الأرشفة…' : 'تأكيد الأرشفة'}</Button></div>
        </form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}

function PhotoPhase({ title, phase, urls, disabled, onUpload }) {
  return (
    <section className="madar-photo-section">
      <div className="madar-photo-heading"><span>{title}</span><span className="madar-muted">{urls?.length ?? 0} / 4</span></div>
      {urls?.length ? <div className="madar-photo-grid">{urls.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer"><img className="madar-photo" src={url} alt={`${title} ${index + 1}`} loading="lazy" /></a>)}</div> : <div className="madar-photo-empty">لا توجد صور بعد</div>}
      {!disabled && (urls?.length ?? 0) < 4 && <label className="madar-photo-upload"><Icon name="upload" size={13} /> رفع 2–4 صور<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={onUpload} aria-label={`رفع صور ${title}`} /></label>}
      {phase && <span className="madar-visually-hidden">{phase}</span>}
    </section>
  );
}
