import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
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
import { Input } from '../../components/ui/Field.jsx';
import OrderTraceStepper from './OrderTraceStepper.jsx';
import './workshop.css';

export default function WorkshopOrderDetail({ canMutate = false, canViewFinance = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: order, loading, error, reload } = useApi(`/api/workshop/orders/${id}`);
  const { data: trace, loading: traceLoading, error: traceError, reload: reloadTrace } = useApi(`/api/workshop/orders/${id}/trace`);
  const { data: costing, reload: reloadCosting } = useApi(canViewFinance ? `/api/workshop/orders/${id}/costing` : null);

  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deliveryMonth, setDeliveryMonth] = useState('');
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
      await reloadTrace();
      showToast('تم رفع ملف التصميم المتجهي.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }, [id, reload, reloadTrace, showToast]);

  async function markReady() {
    setSaving(true);
    try {
      await api.post(`/api/workshop/orders/${id}/ready`, { offcuts: [] });
      await reload();
      await reloadTrace();
      if (canViewFinance) await reloadCosting();
      showToast('تم تحويل الأمر إلى جاهز للتسليم.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function handleQAReview(decision) {
    setSaving(true);
    try {
      await api.post(`/api/workshop/orders/${id}/qa-review`, {
        decision,
        notes: decision === 'approved' ? 'معتمد من مشرف الجودة.' : 'يحتاج إعادة ضبط وتشطيب.',
      });
      await reload();
      await reloadTrace();
      if (canViewFinance) await reloadCosting();
      showToast(decision === 'approved' ? 'تم اعتماد الجودة بنجاح وتحويل الأمر إلى جاهز.' : 'تم إرجاع الأمر للتصنيع لإعادة الضبط.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  async function deliver() {
    if (!deliveryMonth) { showToast('اختر شهر الأرشيف قبل التسليم.', 'error'); return; }
    if (!window.confirm(`تأكيد تسليم ${order.order_code} وأرشفته في شهر ${deliveryMonth} وإصدار فاتورة البيع؟`)) return;
    setSaving(true);
    try {
      const result = await api.post(`/api/workshop/orders/${id}/deliver`, { archiveMonth: deliveryMonth });
      await reload();
      await reloadTrace();
      if (canViewFinance) await reloadCosting();
      showToast(canViewFinance && result.invoice
        ? `تم التسليم والأرشفة. رقم الفاتورة ${result.invoice.code}؛ يُسجّل التحصيل من المالية.`
        : 'تم التسليم والأرشفة وإصدار فاتورة البيع.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
    finally { setSaving(false); }
  }

  // Missing-Rate Surfacing calculation
  const missingLaborRates = useMemo(() => {
    const logs = trace?.production?.stageLogs || [];
    return logs.filter((log) => !log.technician_hourly_rate_cents || Number(log.technician_hourly_rate_cents) <= 0);
  }, [trace]);

  const missingMaterialCosts = useMemo(() => {
    const materials = costing?.materialsUsed || trace?.production?.materialMovements || order?.materialConsumption || [];
    return materials.filter(
      (m) => (m.kind === 'issue' || !m.kind) && Number(m.stamped_unit_cost_cents ?? m.unit_cost_cents ?? 0) <= 0
    );
  }, [costing, trace, order]);

  const hasMissingRates = missingLaborRates.length > 0 || missingMaterialCosts.length > 0;

  if (loading && !order) return <LoadingState label="جارٍ تحميل أمر الورشة ومسار التتبع..." />;
  if (error) {
    return (
      <>
        <PageHeader title="أمر الورشة" actions={<Button variant="secondary" onClick={() => navigate('/workshop')}>العودة للقائمة</Button>} />
        <Alert tone="error">
          {error}
          <div style={{ marginTop: 8 }}>
            <Button size="small" variant="secondary" icon="refresh" onClick={reload}>إعادة المحاولة</Button>
          </div>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="تفاصيل الإنتاج"
        title={order.order_code}
        description="مواصفات المنتج وملفات التصميم ومسار التسليم والتكاليف الفعلية."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" icon="arrow" onClick={() => navigate('/workshop')}>
              كل أوامر الورشة
            </Button>
            {canMutate && (
              <Link to={`/workshop?tab=procurement`}>
                <Button variant="ghost" icon="boxes">
                  المشتريات والتوريدات
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Hero Section */}
      <section className="madar-panel madar-order-hero">
        <div>
          <div className="madar-inline">
            <h2 className="madar-order-client">{order.product_name}</h2>
            <Badge status={order.status} />
            {hasMissingRates && (
              <span className="madar-badge madar-badge-warning" title="يوجد نقص في أجور الفنيين أو تكاليف الخامات">
                تنبيه: أجور أو خامات غير مسعرة
              </span>
            )}
          </div>
          <div className="madar-order-meta">
            <span>العميل <strong>{order.client?.name}</strong></span>
            <span>الآلة <strong>{order.machine_type}</strong></span>
            <span>موعد التسليم <strong>{formatDate(order.target_delivery_date)}</strong></span>
            {canViewFinance && <span>السعر <strong className="madar-money">{formatMoney(order.sale_price_cents)}</strong></span>}
            <span>الفنيون <strong>{order.technicians?.map((item) => item.name).join('، ') || 'غير معيّنين'}</strong></span>
          </div>
          {order.description && <p className="madar-order-notes">{order.description}</p>}
        </div>
        <div className="madar-inline-wrap">
          {canMutate && order.status === 'in_production' && (
            <>
              <Button icon="check" disabled={saving} onClick={markReady}>جاهز للتسليم</Button>
              <Button variant="secondary" icon="shield" disabled={saving} onClick={() => handleQAReview('approved')}>اعتماد الجودة</Button>
            </>
          )}
          {canMutate && order.status === 'ready' && (
            <>
              <Input label="شهر الأرشيف" type="month" required value={deliveryMonth} onChange={(event) => setDeliveryMonth(event.target.value)} />
              <Button icon="arrow" disabled={saving} onClick={deliver}>تسليم وأرشفة</Button>
            </>
          )}
        </div>
      </section>

      {/* Missing-Rate Surfacing Warning Banner */}
      {hasMissingRates && (
        <div className="madar-missing-rate-alert madar-section" role="alert">
          <div className="madar-missing-rate-header">
            <Icon name="alert" size={20} />
            <span>تنبيه تسعير وتشغيل: تم رصد بنود تفتقر لبيانات التكلفة المعتمدة (Missing Rates)</span>
          </div>
          <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>
            النظام يستخدم معدلات حسابية افتراضية مؤقتة. لتفادي انحراف التكاليف وهامش ربح الأمر، يُرجى استكمال البيانات التالية:
          </p>
          <ul className="madar-missing-rate-list">
            {missingLaborRates.map((log) => (
              <li key={log.id}>
                <strong>أجر فني غير محدد:</strong> الفني "{log.employee_name || 'فني ورشة'}" في مرحلة "{log.stage_name}" بدون أجر ساعي مسجل (يتم احتساب الافتراضي 100 ج.م/ساعة).
              </li>
            ))}
            {missingMaterialCosts.map((mat, idx) => (
              <li key={mat.id || idx}>
                <strong>تكلفة خامة مفقودة:</strong> الخامة "{mat.material_name || 'خامة'}" ({mat.material_code || '—'}) منصرفة بدون تكلفة مسجلة (تُحسب حالياً بـ 0 ج.م للوحدة).
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Visual Order Lifecycle Trace Stepper */}
      <OrderTraceStepper
        trace={trace}
        canViewFinance={canViewFinance}
        onReload={async () => {
          await reload();
          await reloadTrace();
          if (canViewFinance) await reloadCosting();
        }}
      />

      {/* Finance & Job Costing Panel */}
      {canViewFinance && costing && (
        <section className="madar-panel madar-section" style={{ border: '1px solid var(--madar-primary, #3b82f6)' }}>
          <div className="madar-panel-header">
            <div>
              <h2>التكاليف الفعلية وربحية الأمر (Job Costing & Profitability)</h2>
              <p>حساب دقيق لتكلفة الخامات المنصرفة، خصم الفضلات، ساعات التشغيل، وهامش الربح.</p>
            </div>
          </div>
          <div className="madar-panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16, textAlign: 'center' }}>
              <div style={{ background: 'var(--madar-surface-subtle, #f8fafc)', padding: 10, borderRadius: 6 }}>
                <small style={{ color: '#64748b' }}>تكلفة الخامات الصافية</small>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: 4 }}>{formatMoney(costing.materialCostCents)}</div>
                {costing.offcutCreditsCents > 0 && <small style={{ color: '#16a34a', display: 'block' }}>خصم فضلات: -{formatMoney(costing.offcutCreditsCents)}</small>}
              </div>
              <div style={{ background: 'var(--madar-surface-subtle, #f8fafc)', padding: 10, borderRadius: 6 }}>
                <small style={{ color: '#64748b' }}>أجور عمالة الفنيين</small>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: 4 }}>{formatMoney(costing.laborCostCents)}</div>
                <small style={{ color: '#64748b' }}>{Math.round(costing.totalLaborMinutes / 60 * 10) / 10} ساعة</small>
              </div>
              <div style={{ background: 'var(--madar-surface-subtle, #f8fafc)', padding: 10, borderRadius: 6 }}>
                <small style={{ color: '#64748b' }}>تشغيل ماكينات CNC</small>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: 4 }}>{formatMoney(costing.machineCostCents)}</div>
                <small style={{ color: '#64748b' }}>{Math.round(costing.totalMachineMinutes / 60 * 10) / 10} ساعة</small>
              </div>
              <div style={{ background: 'var(--madar-surface-subtle, #f8fafc)', padding: 10, borderRadius: 6 }}>
                <small style={{ color: '#64748b' }}>إجمالي التكلفة الفعلية</small>
                <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#e11d48', marginTop: 4 }}>{formatMoney(costing.totalCostCents)}</div>
              </div>
              <div style={{ background: 'var(--madar-surface-subtle, #f8fafc)', padding: 10, borderRadius: 6 }}>
                <small style={{ color: '#64748b' }}>صافي ربح الأمر (الهامش)</small>
                <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#16a34a', marginTop: 4 }}>
                  {formatMoney(costing.grossProfitCents)} ({costing.marginPercent}%)
                </div>
              </div>
            </div>

            {/* Approved vs Actual Variance Analysis */}
            {costing.variance && (
              <div style={{ background: '#0f172a', color: '#f8fafc', padding: 14, borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: '0.95rem' }}>تحليل الانحراف مقارنة بعرض السعر المعتمد (Variance Breakdown)</strong>
                  <span style={{ fontSize: '0.85rem', color: costing.variance.varianceCents > 0 ? '#f87171' : '#4ade80' }}>
                    فرق التكلفة: {costing.variance.varianceCents > 0 ? '+' : ''}{formatMoney(costing.variance.varianceCents)}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: '0.85rem', textAlign: 'center' }}>
                  <div style={{ background: '#1e293b', padding: 6, borderRadius: 4 }}>
                    <span style={{ color: '#94a3b8' }}>التكلفة المعتمدة: </span>
                    <strong>{formatMoney(costing.variance.estimatedTotalCostCents)}</strong>
                  </div>
                  <div style={{ background: '#1e293b', padding: 6, borderRadius: 4 }}>
                    <span style={{ color: '#94a3b8' }}>التكلفة الفعلية: </span>
                    <strong>{formatMoney(costing.variance.actualTotalCostCents)}</strong>
                  </div>
                  <div style={{ background: '#1e293b', padding: 6, borderRadius: 4 }}>
                    <span style={{ color: '#94a3b8' }}>الهامش المستهدف: </span>
                    <strong>{costing.variance.estimatedMarginPercent}%</strong>
                  </div>
                  <div style={{ background: '#1e293b', padding: 6, borderRadius: 4 }}>
                    <span style={{ color: '#94a3b8' }}>الهامش الفعلي: </span>
                    <strong style={{ color: costing.variance.actualMarginPercent >= 20 ? '#4ade80' : '#f87171' }}>
                      {costing.variance.actualMarginPercent}%
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {canViewFinance && order.salesInvoice && (
        <div className="madar-alert madar-alert-success madar-section">
          <Icon name="file" size={15} /> فاتورة البيع <strong className="madar-code">{order.salesInvoice.code}</strong> · {formatMoney(order.salesInvoice.total_cents)} · <Badge status={order.salesInvoice.payment_status} />
        </div>
      )}

      {/* Linked Procurement Section */}
      {(trace?.procurement?.requests?.length > 0 || trace?.procurement?.purchaseOrders?.length > 0) && (
        <section className="madar-panel madar-section">
          <div className="madar-panel-header">
            <div>
              <h2>المشتريات والتوريدات المرتبطة بالأمر</h2>
              <p>متابعة طلبات وأوامر الشراء الواردة لتغطية خامات هذا الأمر.</p>
            </div>
            <Link to={`/workshop?tab=procurement`}>
              <Button size="small" variant="secondary" icon="boxes">
                إدارة المشتريات العامة
              </Button>
            </Link>
          </div>
          <div className="madar-panel-body">
            {trace.procurement.requests?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <strong style={{ display: 'block', marginBottom: 6 }}>طلبات الشراء الصادرة:</strong>
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>كود الطلب</th><th>الخامة</th><th>الكمية المطلوبة</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {trace.procurement.requests.map((pr) => (
                        <tr key={pr.id}>
                          <td className="madar-code">{pr.request_code}</td>
                          <td>{pr.material_name} ({pr.material_code})</td>
                          <td><strong>{pr.requested_quantity}</strong></td>
                          <td><Badge status={pr.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {trace.procurement.purchaseOrders?.length > 0 && (
              <div>
                <strong style={{ display: 'block', marginBottom: 6 }}>أوامر الشراء والتوريد:</strong>
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>أمر الشراء</th><th>المورّد</th><th>موعد التوريد</th><th>الحالة</th><th>الأذون المستلمة</th></tr></thead>
                    <tbody>
                      {trace.procurement.purchaseOrders.map((po) => (
                        <tr key={po.id}>
                          <td className="madar-code">{po.po_code}</td>
                          <td>{po.supplier}</td>
                          <td>{formatDate(po.expected_date)}</td>
                          <td><Badge status={po.status} /></td>
                          <td>{po.receipts?.length || 0} إذن استلام</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Vector Design Files */}
      <section className="madar-panel madar-section">
        <div className="madar-panel-header">
          <div>
            <h2>ملفات التصميم المتجهي</h2>
            <p>ملفات جاهزة للتنزيل لمشغلي CNC وLaser · DXF, CDR, AI, PDF</p>
          </div>
          {order.status !== 'delivered_archived' && <span className="madar-badge madar-badge-info">حد أقصى 40 MB</span>}
        </div>
        <div className="madar-panel-body madar-stack">
          {order.designFiles?.length ? (
            <div className="madar-file-list">
              {order.designFiles.map((file) => (
                <a className="madar-file-link" href={file.download_url} key={file.id}>
                  <span className="madar-file-type">{file.extension?.slice(1).toUpperCase()}</span>
                  <span className="madar-file-copy">
                    <strong>{file.original_name}</strong>
                    <small>{(file.byte_size / 1024 / 1024).toFixed(2)} MB · {formatDate(file.created_at)}</small>
                  </span>
                  <Icon name="download" size={15} />
                </a>
              ))}
            </div>
          ) : (
            <EmptyState icon="file" title="لا توجد ملفات تصميم" description="ارفع ملف الرسم المتجهي المرتبط بهذا الأمر." />
          )}
          {canMutate && order.status !== 'delivered_archived' && (
            <label
              className={`madar-upload-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); uploadDesign(event.dataTransfer.files); }}
            >
              <input
                className="madar-visually-hidden"
                type="file"
                accept=".dxf,.cdr,.ai,.pdf,application/pdf"
                onChange={(event) => { uploadDesign(event.target.files); event.target.value = ''; }}
                disabled={saving}
              />
              <span>
                <Icon name="upload" size={22} />
                <strong>{saving ? 'جارٍ رفع الملف…' : 'اسحب ملف التصميم هنا أو اختر ملفاً'}</strong>
                <small>الامتدادات المسموحة: .dxf · .cdr · .ai · .pdf</small>
              </span>
            </label>
          )}
        </div>
      </section>

      {/* Material Movements */}
      {order.materialConsumption?.length > 0 && (
        <section className="madar-panel madar-section">
          <div className="madar-panel-header">
            <div>
              <h2>حركة المواد والخامات المنصرفة</h2>
              <p>مصدر الصرف ومخزون الورشة</p>
            </div>
          </div>
          <div className="madar-table-wrap">
            <table className="madar-table">
              <thead><tr><th>المادة</th><th>المخزن</th><th>المرجع</th><th>التاريخ</th></tr></thead>
              <tbody>
                {order.materialConsumption.map((movement) => (
                  <tr key={movement.id}>
                    <td>{movement.material_name} · {movement.material_code ?? ''}</td>
                    <td>{movement.warehouse === 'main' ? 'رئيسي' : 'ثانوي'}</td>
                    <td className="madar-code">{movement.reference}</td>
                    <td>{formatDate(movement.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
