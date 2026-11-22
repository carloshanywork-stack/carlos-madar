import { useState } from 'react';
import { formatDate, formatMoney } from '../../lib/format.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Icon from '../../components/ui/Icon.jsx';
import './workshop.css';

const stageNamesAr = {
  design_cam: 'التصميم والبرمجة CAM',
  cnc_laser: 'قص وقص الليزر / CNC',
  bending_assembly: 'الثني والتجميع',
  wiring_led: 'الكهرباء وليدات الإضاءة',
  finishing: 'التشطيب والدهان',
  qa_inspection: 'فحص وضبط الجودة',
  site_installation: 'التركيب الميداني',
};

export default function OrderTraceStepper({ trace, canViewFinance = false, onReload }) {
  const [selectedStep, setSelectedStep] = useState(null);

  if (!trace) return null;

  const { order, quotation, snapshot, reservations = [], procurement = {}, production = {}, salesAndTreasury = {}, costing } = trace;
  const { requests = [], purchaseOrders = [], supplierInvoices = [] } = procurement;
  const { stageLogs = [], inspections = [], materialMovements = [] } = production;
  const { salesInvoice, customerReceipts = [] } = salesAndTreasury;

  // Determine status of each of the 8 milestones
  // 1. Quotation
  const hasApprovedQuote = snapshot || quotation?.status === 'approved' || quotation?.status === 'converted_to_order';
  const quoteStatus = hasApprovedQuote ? 'completed' : quotation ? 'warning' : 'skipped';
  const quoteSub = quotation ? quotation.quotation_code : 'مباشر دون عرض';

  // 2. Workshop Order
  const orderStatus = order?.id ? 'completed' : 'pending';
  const orderSub = order?.order_code || '—';

  // 3. Reservations & Purchase Requests
  const totalReserved = reservations.length;
  const totalPrs = requests.length;
  const reservationStatus = totalReserved > 0 || totalPrs > 0 ? 'completed' : 'skipped';
  const reservationSub = `${totalReserved} حجز · ${totalPrs} طلب`;

  // 4. Goods Receipts
  const allPos = purchaseOrders;
  const totalReceipts = allPos.reduce((sum, po) => sum + (po.receipts?.length || 0), 0);
  const allPosReceived = allPos.length > 0 && allPos.every((po) => po.status === 'received');
  const somePosReceived = totalReceipts > 0;
  const receiptStatus = allPos.length === 0 ? 'skipped' : allPosReceived ? 'completed' : somePosReceived ? 'in_progress' : 'pending';
  const receiptSub = allPos.length === 0 ? 'لا يتطلب توريد' : `${totalReceipts} إذن استلام`;

  // 5. Stage Logs
  const totalMinutes = stageLogs.reduce((sum, log) => sum + (Number(log.duration_minutes) || 0), 0);
  const totalHours = Math.round(totalMinutes / 60 * 10) / 10;
  const stageStatus = stageLogs.length > 0 ? (order.status === 'in_production' ? 'in_progress' : 'completed') : 'pending';
  const stageSub = stageLogs.length > 0 ? `${totalHours} س (${stageLogs.length} مرحلة)` : 'بانتظار التسجيل';

  // 6. QA Review
  const lastInspection = inspections.length > 0 ? inspections[inspections.length - 1] : null;
  const qaStatus = lastInspection
    ? (lastInspection.decision === 'approved' ? 'completed' : 'rework')
    : (order.status === 'ready' || order.status === 'delivered_archived' ? 'completed' : 'pending');
  const qaSub = lastInspection
    ? (lastInspection.decision === 'approved' ? 'معتمد' : 'مطلوب إعادة ضبط')
    : 'بانتظار الفحص';

  // 7. Delivery & Invoicing
  const deliveryStatus = order.status === 'delivered_archived' ? 'completed' : order.status === 'ready' ? 'in_progress' : 'pending';
  const deliverySub = order.status === 'delivered_archived'
    ? (salesInvoice ? salesInvoice.code : 'تم التسليم')
    : order.status === 'ready' ? 'جاهز للتسليم' : 'قيد التشغيل';

  // 8. Financial Variance
  const hasVariance = Boolean(costing && costing.variance);
  const varianceStatus = costing ? (hasVariance && costing.variance.actualMarginPercent >= 20 ? 'completed' : hasVariance ? 'warning' : 'completed') : 'pending';
  const varianceSub = costing
    ? (hasVariance ? `هامش ${costing.variance.actualMarginPercent}%` : `ربح ${costing.marginPercent}%`)
    : 'غير متوفر';

  const milestones = [
    {
      id: 'quotation',
      index: 1,
      title: 'عرض السعر المعتمد',
      sub: quoteSub,
      status: quoteStatus,
      icon: 'calculator',
    },
    {
      id: 'order',
      index: 2,
      title: 'أمر التشغيل',
      sub: orderSub,
      status: orderStatus,
      icon: 'factory',
    },
    {
      id: 'reservation',
      index: 3,
      title: 'حجز وطلب الخامات',
      sub: reservationSub,
      status: reservationStatus,
      icon: 'boxes',
    },
    {
      id: 'receipt',
      index: 4,
      title: 'استلام التوريدات',
      sub: receiptSub,
      status: receiptStatus,
      icon: 'archive',
    },
    {
      id: 'stage_logs',
      index: 5,
      title: 'مراحل الإنتاج',
      sub: stageSub,
      status: stageStatus,
      icon: 'wrench',
    },
    {
      id: 'qa',
      index: 6,
      title: 'مراجعة واعتماد الجودة',
      sub: qaSub,
      status: qaStatus,
      icon: 'shield',
    },
    {
      id: 'delivery',
      index: 7,
      title: 'التسليم والفوترة',
      sub: deliverySub,
      status: deliveryStatus,
      icon: 'file',
    },
    {
      id: 'variance',
      index: 8,
      title: 'التحليل المالي والانحراف',
      sub: varianceSub,
      status: varianceStatus,
      icon: 'chart',
    },
  ];

  return (
    <section className="madar-stepper-container" aria-label="تتبع دورة حياة أمر الورشة">
      <div className="madar-stepper-header">
        <div className="madar-stepper-title">
          <Icon name="history" size={18} />
          <span>مسار دورة حياة الأمر المتكاملة (Order Lifecycle Trace)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="madar-badge madar-badge-info">8 محطات تدقيق</span>
          {onReload && (
            <Button size="small" variant="ghost" icon="refresh" onClick={onReload}>
              تحديث التتبع
            </Button>
          )}
        </div>
      </div>

      <div className="madar-stepper-track">
        {milestones.map((m) => {
          const isSelected = selectedStep === m.id;
          return (
            <div
              key={m.id}
              className={`madar-step-item ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedStep(isSelected ? null : m.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedStep(isSelected ? null : m.id); }}
            >
              <div className={`madar-step-circle ${m.status}`}>
                {m.status === 'completed' ? (
                  <Icon name="check" size={16} />
                ) : m.status === 'in_progress' ? (
                  <Icon name="clock" size={16} />
                ) : m.status === 'warning' || m.status === 'rework' ? (
                  <Icon name="alert" size={16} />
                ) : (
                  <span>{m.index}</span>
                )}
              </div>
              <div className="madar-step-label">{m.title}</div>
              <div className="madar-step-sub">{m.sub}</div>
              <span className={`madar-step-badge madar-badge-${m.status === 'completed' ? 'success' : m.status === 'in_progress' ? 'info' : m.status === 'warning' || m.status === 'rework' ? 'warning' : 'muted'}`}>
                {m.status === 'completed' ? 'مكتمل' : m.status === 'in_progress' ? 'جارٍ' : m.status === 'rework' ? 'إعادة ضبط' : m.status === 'skipped' ? 'مباشر' : 'بانتظار'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Detail drawer for the selected milestone */}
      {selectedStep && (
        <div className="madar-step-detail-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <Icon name="file" size={16} />
              تفاصيل المحطة: {milestones.find((m) => m.id === selectedStep)?.title}
            </h4>
            <Button size="small" variant="ghost" icon="close" onClick={() => setSelectedStep(null)}>
              إغلاق
            </Button>
          </div>

          {selectedStep === 'quotation' && (
            <div>
              {quotation ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div><strong>كود المقايسة:</strong> <span className="madar-code">{quotation.quotation_code}</span></div>
                  <div><strong>عنوان المقايسة:</strong> {quotation.title}</div>
                  <div><strong>حالة العرض:</strong> <Badge status={quotation.status} /></div>
                  <div><strong>تاريخ الإنشاء:</strong> {formatDate(quotation.created_at)}</div>
                  {canViewFinance && (
                    <>
                      <div><strong>التكلفة المقدرة:</strong> {formatMoney(quotation.estimated_cost_cents)}</div>
                      <div><strong>صافي سعر البيع:</strong> {formatMoney(quotation.net_sale_price_cents)}</div>
                      <div><strong>الهامش المستهدف:</strong> {Math.round((quotation.target_margin || 0) * 100)}%</div>
                    </>
                  )}
                  {snapshot && (
                    <div style={{ gridColumn: '1 / -1', background: 'var(--madar-surface)', padding: 10, borderRadius: 6, marginTop: 6 }}>
                      <span className="madar-badge madar-badge-success">لقطة معتمدة ومجمدة (Frozen Snapshot v{snapshot.version_number})</span>
                      <small style={{ display: 'block', color: 'var(--madar-muted)', marginTop: 4 }}>
                        هاش التجميد: <code className="madar-code">{snapshot.snapshot_hash_sha256}</code>
                      </small>
                    </div>
                  )}
                </div>
              ) : (
                <p className="madar-table-muted">أُنشئ هذا الأمر مباشرة دون مقايسة أو عرض سعر مسبق.</p>
              )}
            </div>
          )}

          {selectedStep === 'order' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <div><strong>كود الأمر:</strong> <span className="madar-code">{order.order_code}</span></div>
              <div><strong>العميل:</strong> {order.client_name}</div>
              <div><strong>المنتج:</strong> {order.product_name}</div>
              <div><strong>الماكينة المطلوبة:</strong> {order.machine_type}</div>
              <div><strong>تاريخ التسليم المستهدف:</strong> {formatDate(order.target_delivery_date)}</div>
              <div><strong>الحالة:</strong> <Badge status={order.status} /></div>
            </div>
          )}

          {selectedStep === 'reservation' && (
            <div>
              <h5 style={{ margin: '0 0 8px 0', fontWeight: 600 }}>المواد المحجوزة بالمخزن ({reservations.length})</h5>
              {reservations.length ? (
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>المادة</th><th>كود المادة</th><th>الكمية المحجوزة</th><th>تاريخ الحجز</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {reservations.map((r) => (
                        <tr key={r.id}>
                          <td>{r.material_name}</td>
                          <td className="madar-code">{r.material_code}</td>
                          <td>{r.quantity_reserved}</td>
                          <td>{formatDate(r.created_at)}</td>
                          <td><Badge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="madar-table-muted">لا توجد حجوزات مخزنية مسجلة لهذا الأمر.</p>}

              <h5 style={{ margin: '14px 0 8px 0', fontWeight: 600 }}>طلبات الشراء الصادرة ({requests.length})</h5>
              {requests.length ? (
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>رقم الطلب</th><th>المادة</th><th>الكمية المطلوبة</th><th>الحالة</th><th>ملاحظات</th></tr></thead>
                    <tbody>
                      {requests.map((pr) => (
                        <tr key={pr.id}>
                          <td className="madar-code">{pr.request_code}</td>
                          <td>{pr.material_name}</td>
                          <td>{pr.requested_quantity}</td>
                          <td><Badge status={pr.status} /></td>
                          <td>{pr.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="madar-table-muted">لم يتم إصدار طلبات شراء خارجية لهذا الأمر.</p>}
            </div>
          )}

          {selectedStep === 'receipt' && (
            <div>
              <h5 style={{ margin: '0 0 8px 0', fontWeight: 600 }}>أوامر الشراء المرتبطة ({purchaseOrders.length})</h5>
              {purchaseOrders.length ? (
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>رقم أمر الشراء</th><th>المورّد</th><th>تاريخ التسليم</th><th>إجمالي القيمة</th><th>الحالة</th><th>الأذون المستلمة</th></tr></thead>
                    <tbody>
                      {purchaseOrders.map((po) => (
                        <tr key={po.id}>
                          <td className="madar-code">{po.po_code}</td>
                          <td>{po.supplier}</td>
                          <td>{formatDate(po.expected_date)}</td>
                          <td>{canViewFinance ? formatMoney(po.total_cents) : '—'}</td>
                          <td><Badge status={po.status} /></td>
                          <td>{po.receipts?.length || 0} إذن استلام</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="madar-table-muted">لا توجد أوامر شراء خارجية مسجلة.</p>}
            </div>
          )}

          {selectedStep === 'stage_logs' && (
            <div>
              <h5 style={{ margin: '0 0 8px 0', fontWeight: 600 }}>سجل مراحل الفنيين والماكينات ({stageLogs.length})</h5>
              {stageLogs.length ? (
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>المرحلة</th><th>الفني المسؤول</th><th>المدة</th><th>الإجراء</th><th>تاريخ التسجيل</th></tr></thead>
                    <tbody>
                      {stageLogs.map((log) => (
                        <tr key={log.id}>
                          <td><strong>{stageNamesAr[log.stage_name] || log.stage_name}</strong></td>
                          <td>{log.employee_name || 'فني ورشة'}</td>
                          <td>{log.duration_minutes ? `${log.duration_minutes} دقيقة` : '—'}</td>
                          <td><span className="madar-badge madar-badge-info">{log.action}</span></td>
                          <td>{formatDate(log.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="madar-table-muted">لم تُسجل أي مراحل عمل فنية بعد.</p>}
            </div>
          )}

          {selectedStep === 'qa' && (
            <div>
              <h5 style={{ margin: '0 0 8px 0', fontWeight: 600 }}>سجل فحوصات الجودة ({inspections.length})</h5>
              {inspections.length ? (
                <div className="madar-table-wrap">
                  <table className="madar-table">
                    <thead><tr><th>تاريخ الفحص</th><th>المفتش المسؤول</th><th>القرار</th><th>ملاحظات الجودة</th></tr></thead>
                    <tbody>
                      {inspections.map((insp) => (
                        <tr key={insp.id}>
                          <td>{formatDate(insp.created_at)}</td>
                          <td>{insp.inspector_name || 'مشرف الجودة'}</td>
                          <td>
                            <span className={`madar-badge madar-badge-${insp.decision === 'approved' ? 'success' : 'danger'}`}>
                              {insp.decision === 'approved' ? 'اعتماد مطابق للمواصفات' : 'إعادة ضبط وتشغيل (Rework)'}
                            </span>
                          </td>
                          <td>{insp.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="madar-table-muted">لم يُجرَ فحص جودة رسمي بعد.</p>}
            </div>
          )}

          {selectedStep === 'delivery' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <div><strong>حالة التسليم:</strong> <Badge status={order.status} /></div>
              <div><strong>تاريخ التسليم الفعلي:</strong> {formatDate(order.delivered_at)}</div>
              <div><strong>شهر الأرشيف:</strong> {order.archive_month || '—'}</div>
              {salesInvoice && (
                <>
                  <div><strong>رقم فاتورة المبيعات:</strong> <span className="madar-code">{salesInvoice.code}</span></div>
                  <div><strong>إجمالي الفاتورة:</strong> {canViewFinance ? formatMoney(salesInvoice.total_cents) : '—'}</div>
                  <div><strong>حالة التحصيل:</strong> <Badge status={salesInvoice.payment_status} /></div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>سندات القبض المحصلة:</strong> {customerReceipts.length} سند تحصيل في الخزينة
                  </div>
                </>
              )}
            </div>
          )}

          {selectedStep === 'variance' && (
            <div>
              {costing ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div><strong>سعر البيع الصافي:</strong> {canViewFinance ? formatMoney(costing.salePriceCents) : '—'}</div>
                  <div><strong>تكلفة الخامات:</strong> {canViewFinance ? formatMoney(costing.materialCostCents) : '—'}</div>
                  <div><strong>أجور الفنيين:</strong> {canViewFinance ? formatMoney(costing.laborCostCents) : '—'}</div>
                  <div><strong>تشغيل الماكينات:</strong> {canViewFinance ? formatMoney(costing.machineCostCents) : '—'}</div>
                  <div><strong>إجمالي التكلفة الفعلية:</strong> <strong style={{ color: '#e11d48' }}>{canViewFinance ? formatMoney(costing.totalCostCents) : '—'}</strong></div>
                  <div><strong>مجمل الربح الفعلي:</strong> <strong style={{ color: '#16a34a' }}>{canViewFinance ? formatMoney(costing.grossProfitCents) : '—'}</strong></div>
                  <div><strong>هامش الربح الفعلي:</strong> <strong>{costing.marginPercent}%</strong></div>
                  <div><strong>نسبة المارك آب (Markup):</strong> <strong>{costing.markupPercent}%</strong></div>
                  {costing.variance && (
                    <div style={{ gridColumn: '1 / -1', background: '#0f172a', color: '#f8fafc', padding: 12, borderRadius: 6, marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong>مقارنة الانحراف بالعرض المعتمد:</strong>
                        <span style={{ color: costing.variance.varianceCents > 0 ? '#f87171' : '#4ade80' }}>
                          فرق التكلفة: {costing.variance.varianceCents > 0 ? '+' : ''}{canViewFinance ? formatMoney(costing.variance.varianceCents) : '—'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.85rem' }}>
                        الهامش المستهدف: {costing.variance.estimatedMarginPercent}% ⟵ الهامش الفعلي المحقق: {costing.variance.actualMarginPercent}%
                      </div>
                    </div>
                  )}
                </div>
              ) : <p className="madar-table-muted">بيانات التحليل المالي غير متاحة حالياً.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
