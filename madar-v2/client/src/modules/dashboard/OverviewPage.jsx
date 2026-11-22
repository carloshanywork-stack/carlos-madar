import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDate, formatMoney, errorMessage } from '../../lib/format.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Icon from '../../components/ui/Icon.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Alert from '../../components/ui/Alert.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import '../workshop/workshop.css';

const maintenanceNames = {
  in_progress: 'قيد التنفيذ',
  review: 'مراجعة',
};
const machineNames = { cnc_router: 'CNC Router', laser: 'Laser', both: 'CNC + Laser', manual: 'يدوي' };

export default function OverviewPage() {
  const [dashboard, setDashboard] = useState(null);
  const [profitability, setProfitability] = useState(null);
  const [profitabilityError, setProfitabilityError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Profitability Filters
  const [profStatusFilter, setProfStatusFilter] = useState('all');
  const [profHealthFilter, setProfHealthFilter] = useState('all');
  const [profSearch, setProfSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setProfitabilityError('');
    try {
      const [clients, maintenance, review, production, ready, materials] = await Promise.all([
        api.get('/api/clients'),
        api.get('/api/maintenance/orders?status=in_progress'),
        api.get('/api/maintenance/orders?status=review'),
        api.get('/api/workshop/orders?status=in_production'),
        api.get('/api/workshop/orders?status=ready'),
        api.get('/api/warehouse/materials'),
      ]);

      const recentMaintenance = [...maintenance, ...review]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 5);

      const maintenanceDetails = await Promise.all(
        recentMaintenance.map(async (order) => {
          try {
            return await api.get(`/api/maintenance/orders/${order.id}`);
          } catch {
            return { ...order, cards: [] };
          }
        })
      );

      setDashboard({
        clients,
        maintenance,
        review,
        production,
        ready,
        materials,
        recentMaintenance: maintenanceDetails,
        recentWorkshop: [...production, ...ready]
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, 5),
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }

    // Attempt loading workshop profitability summary
    try {
      const profData = await api.get('/api/workshop/profitability');
      setProfitability(profData);
    } catch (caught) {
      // Graceful degradation if user lacks finance permissions (403) or offline
      if (caught?.status === 403 || caught?.status === 401) {
        setProfitability(null);
        setProfitabilityError('بيانات الربحية الإدارية تتطلب صلاحيات الإدارة المالية أو مدير النظام.');
      } else {
        setProfitabilityError(errorMessage(caught));
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lowStockCount = useMemo(
    () => dashboard?.materials?.filter((item) => item.is_low_stock).length ?? 0,
    [dashboard]
  );

  const kpis = dashboard
    ? [
        { label: 'العملاء النشطون', value: dashboard.clients.length, foot: 'ملفات العملاء المسجلة', icon: 'users', to: '/clients', tone: 'teal' },
        { label: 'الصيانة الميدانية', value: dashboard.maintenance.length + dashboard.review.length, foot: `${dashboard.review.length} بانتظار المراجعة`, icon: 'wrench', to: '/maintenance', tone: 'blue' },
        { label: 'تشغيل الورشة', value: dashboard.production.length, foot: `${dashboard.ready.length} جاهز للتسليم`, icon: 'factory', to: '/workshop', tone: 'gold' },
        { label: 'المخزون والمواد', value: lowStockCount, foot: 'مواد عند حد إعادة الطلب', icon: 'boxes', to: '/warehouse', tone: 'rose' },
      ]
    : [];

  // Filtered orders for profitability section
  const filteredProfOrders = useMemo(() => {
    if (!profitability?.orders) return [];
    return profitability.orders.filter((order) => {
      const matchSearch = `${order.orderCode} ${order.clientName || ''} ${order.productName || ''}`
        .toLowerCase()
        .includes(profSearch.toLowerCase());
      const matchStatus = profStatusFilter === 'all' || order.status === profStatusFilter;
      const margin = order.marginPercent || 0;
      let matchHealth = true;
      if (profHealthFilter === 'target') matchHealth = margin >= 20;
      else if (profHealthFilter === 'low') matchHealth = margin >= 0 && margin < 20;
      else if (profHealthFilter === 'loss') matchHealth = margin < 0;
      return matchSearch && matchStatus && matchHealth;
    });
  }, [profitability, profSearch, profStatusFilter, profHealthFilter]);

  // Aggregate metrics for filtered subset
  const filteredSummary = useMemo(() => {
    const list = filteredProfOrders;
    const revenue = list.reduce((s, o) => s + (Number(o.salePriceCents) || 0), 0);
    const cogs = list.reduce((s, o) => s + (Number(o.totalCostCents) || 0), 0);
    const mat = list.reduce((s, o) => s + (Number(o.materialCostCents) || 0), 0);
    const lab = list.reduce((s, o) => s + (Number(o.laborCostCents) || 0), 0);
    const mac = list.reduce((s, o) => s + (Number(o.machineCostCents) || 0), 0);
    const profit = revenue - cogs;
    const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
    const markup = cogs > 0 ? Math.round((profit / cogs) * 1000) / 10 : 0;
    return { revenue, cogs, mat, lab, mac, profit, margin, markup, count: list.length };
  }, [filteredProfOrders]);

  return (
    <>
      <PageHeader
        kicker="نظرة عامة · MADAR V2"
        title="صباح التشغيل الجيد"
        description="تابع حركة الصيانة والورشة والمخزون والتكاليف الفعلية من مساحة عمل واحدة."
        actions={
          <button type="button" className="madar-button madar-button-secondary" onClick={load}>
            <Icon name="refresh" size={14} /> تحديث البيانات
          </button>
        }
      />

      {error && (
        <div className="madar-section">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {loading && !dashboard ? (
        <LoadingState label="جارٍ تحميل لوحة المتابعة..." />
      ) : (
        <>
          {/* Main Top KPIs */}
          <div className="madar-grid madar-grid-4">
            {kpis.map((item) => (
              <Link to={item.to} className="madar-kpi-link" key={item.label}>
                <article className={`madar-panel madar-kpi madar-kpi-${item.tone}`}>
                  <div className="madar-kpi-top">
                    <span className="madar-kpi-label">{item.label}</span>
                    <span className="madar-kpi-icon"><Icon name={item.icon} /></span>
                  </div>
                  <div className="madar-kpi-value">{item.value}</div>
                  <div className="madar-kpi-foot"><strong>{item.foot}</strong></div>
                </article>
              </Link>
            ))}
          </div>

          {/* Management Dashboard Profitability Widget */}
          <section className="madar-panel madar-section">
            <div className="madar-panel-header">
              <div>
                <h2>مؤشرات ربحية الورشة وتكاليف الأوامر (Job Costing & Profitability)</h2>
                <p>متابعة صافي المبيعات، تكاليف الإنتاج الفعلية (COGS)، مجمل الأرباح، ونسب الهامش والمارك آب.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Link to="/workshop">
                  <Button size="small" variant="secondary" icon="factory">
                    أوامر الورشة
                  </Button>
                </Link>
              </div>
            </div>

            {profitability ? (
              <div className="madar-panel-body">
                {/* 5 KPI Metric Cards */}
                <div className="madar-profitability-kpi-grid">
                  <div className="madar-profitability-kpi-card" style={{ '--card-accent': '#187b68' }}>
                    <div className="madar-profitability-kpi-label">صافي المبيعات (Net Sales)</div>
                    <div className="madar-profitability-kpi-value madar-money">
                      {formatMoney(filteredSummary.revenue)}
                    </div>
                    <div className="madar-profitability-kpi-foot">إجمالي قيمة الأوامر المفوترة والمعتمدة</div>
                  </div>

                  <div className="madar-profitability-kpi-card" style={{ '--card-accent': '#e11d48' }}>
                    <div className="madar-profitability-kpi-label">تكلفة الإنتاج الفعلية (COGS)</div>
                    <div className="madar-profitability-kpi-value madar-money" style={{ color: '#e11d48' }}>
                      {formatMoney(filteredSummary.cogs)}
                    </div>
                    <div className="madar-profitability-kpi-foot">
                      خامات: {formatMoney(filteredSummary.mat)} · أجور: {formatMoney(filteredSummary.lab)}
                    </div>
                  </div>

                  <div className="madar-profitability-kpi-card" style={{ '--card-accent': '#16a34a' }}>
                    <div className="madar-profitability-kpi-label">مجمل الأرباح (Gross Profit)</div>
                    <div className="madar-profitability-kpi-value madar-money" style={{ color: filteredSummary.profit >= 0 ? '#16a34a' : '#ef4444' }}>
                      {formatMoney(filteredSummary.profit)}
                    </div>
                    <div className="madar-profitability-kpi-foot">الفرق بين سعر البيع والتكلفة الفعلية</div>
                  </div>

                  <div className="madar-profitability-kpi-card" style={{ '--card-accent': '#3b82f6' }}>
                    <div className="madar-profitability-kpi-label">نسبة هامش الربح (Margin %)</div>
                    <div className="madar-profitability-kpi-value" style={{ color: filteredSummary.margin >= 20 ? '#16a34a' : '#f59e0b' }}>
                      {filteredSummary.margin}%
                    </div>
                    <div className="madar-profitability-kpi-foot">الربح ÷ المبيعات (المستهدف &gt;= 20%)</div>
                  </div>

                  <div className="madar-profitability-kpi-card" style={{ '--card-accent': '#8b5cf6' }}>
                    <div className="madar-profitability-kpi-label">نسبة العلامة (Markup %)</div>
                    <div className="madar-profitability-kpi-value">
                      {filteredSummary.markup}%
                    </div>
                    <div className="madar-profitability-kpi-foot">الربح ÷ التكلفة الفعلية (On Cost)</div>
                  </div>
                </div>

                {/* Filter Toolbar */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                  <label className="madar-field madar-search" style={{ minWidth: 240, flex: 1 }}>
                    <Icon name="search" size={15} />
                    <input
                      value={profSearch}
                      onChange={(e) => setProfSearch(e.target.value)}
                      placeholder="ابحث برقم الأمر أو العميل أو المنتج..."
                      aria-label="بحث أوامر الربحية"
                    />
                  </label>

                  <select
                    className="madar-field"
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--madar-border)' }}
                    value={profStatusFilter}
                    onChange={(e) => setProfStatusFilter(e.target.value)}
                    aria-label="تصفية حسب مرحلة الأمر"
                  >
                    <option value="all">كل مراحل التشغيل</option>
                    <option value="in_production">قيد التشغيل</option>
                    <option value="ready">جاهز للتسليم</option>
                    <option value="delivered_archived">تم التسليم ومؤرشف</option>
                  </select>

                  <select
                    className="madar-field"
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--madar-border)' }}
                    value={profHealthFilter}
                    onChange={(e) => setProfHealthFilter(e.target.value)}
                    aria-label="تصفية حسب صحة الهامش"
                  >
                    <option value="all">كل الهوامش</option>
                    <option value="target">هوامش صحية ومطابقة (≥ 20%)</option>
                    <option value="low">هوامش منخفضة (&lt; 20%)</option>
                    <option value="loss">أوامر خاسرة (&lt; 0%)</option>
                  </select>
                </div>

                {/* Orders Costing Table */}
                {filteredProfOrders.length ? (
                  <div className="madar-table-wrap">
                    <table className="madar-table">
                      <thead>
                        <tr>
                          <th>أمر التشغيل</th>
                          <th>العميل</th>
                          <th>المنتج</th>
                          <th>الحالة</th>
                          <th>سعر البيع</th>
                          <th>التكلفة الفعلية</th>
                          <th>مجمل الربح</th>
                          <th>الهامش %</th>
                          <th>المارك آب %</th>
                          <th>انحراف المقايسة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProfOrders.map((ord) => {
                          const margin = ord.marginPercent || 0;
                          return (
                            <tr key={ord.orderId}>
                              <td>
                                <Link className="madar-table-link madar-code" to={`/workshop/${ord.orderId}`}>
                                  {ord.orderCode}
                                </Link>
                              </td>
                              <td>{ord.clientName || '—'}</td>
                              <td>{ord.productName}</td>
                              <td><Badge status={ord.status} /></td>
                              <td className="madar-money">{formatMoney(ord.salePriceCents)}</td>
                              <td className="madar-money" style={{ color: '#e11d48' }}>{formatMoney(ord.totalCostCents)}</td>
                              <td className="madar-money" style={{ color: ord.grossProfitCents >= 0 ? '#16a34a' : '#ef4444', fontWeight: 700 }}>
                                {formatMoney(ord.grossProfitCents)}
                              </td>
                              <td>
                                <span style={{ color: margin >= 20 ? '#16a34a' : margin >= 0 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>
                                  {margin}%
                                </span>
                              </td>
                              <td>{ord.markupPercent || 0}%</td>
                              <td>
                                {ord.variance ? (
                                  <span style={{ fontSize: '0.85rem', color: ord.variance.varianceCents > 0 ? '#ef4444' : '#16a34a' }}>
                                    {ord.variance.varianceCents > 0 ? `+${formatMoney(ord.variance.varianceCents)}` : 'مطابق للتقديري'}
                                  </span>
                                ) : (
                                  <span className="madar-table-muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon="chart"
                    title="لا توجد أوامر مطابقة لخيارات التصفية"
                    description="جرّب تعديل كلمات البحث أو تصفية مراحل التشغيل أو الهامش."
                  />
                )}
              </div>
            ) : profitabilityError ? (
              <div className="madar-panel-body">
                <Alert tone="info">
                  <Icon name="shield" size={16} /> {profitabilityError}
                </Alert>
              </div>
            ) : (
              <div className="madar-panel-body">
                <LoadingState label="جارٍ تحميل تحليل ربحية الورشة..." />
              </div>
            )}
          </section>

          {/* Maintenance & Workshop Recent Feeds */}
          <div className="madar-grid madar-grid-2 madar-section">
            <section className="madar-panel">
              <div className="madar-panel-header">
                <div><h2>أحدث أعمال الصيانة الميدانية</h2><p>متابعة التشغيل دون بيانات مالية</p></div>
                <Link className="madar-button madar-button-ghost madar-button-small" to="/maintenance">عرض الكل <Icon name="chevron" size={13} /></Link>
              </div>
              {dashboard?.recentMaintenance.length ? (
                <div className="madar-table-wrap"><table className="madar-table">
                  <thead><tr><th>رقم الأمر</th><th>العميل</th><th>المنطقة</th><th>الآلات</th><th>الحالة</th></tr></thead>
                  <tbody>{dashboard.recentMaintenance.map((order) => {
                    const cards = order.cards ?? [];
                    const areas = [...new Set(cards.map((card) => card.machine_area).filter(Boolean))];
                    return (
                      <tr key={order.id}>
                        <td><Link className="madar-table-link madar-code" to={`/maintenance/${order.id}`}>{order.order_code}</Link></td>
                        <td>{order.client_name}</td>
                        <td>{areas.join('، ') || '—'}</td>
                        <td>{cards.length}</td>
                        <td><Badge status={order.status}>{maintenanceNames[order.status] ?? order.status}</Badge></td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              ) : <EmptyState icon="wrench" title="لا توجد أعمال صيانة حديثة" description="ستظهر هنا الأوامر الجارية والمراجعة." />}
            </section>

            <section className="madar-panel">
              <div className="madar-panel-header">
                <div><h2>أحدث أوامر تشغيل الورشة</h2><p>الإنتاج الجاري والأوامر الجاهزة للتسليم</p></div>
                <Link className="madar-button madar-button-ghost madar-button-small" to="/workshop">عرض الكل <Icon name="chevron" size={13} /></Link>
              </div>
              {dashboard?.recentWorkshop.length ? (
                <div className="madar-table-wrap"><table className="madar-table">
                  <thead><tr><th>رقم الأمر</th><th>العميل</th><th>المنتج</th><th>الآلة</th><th>التسليم المتوقع</th><th>الحالة</th></tr></thead>
                  <tbody>{dashboard.recentWorkshop.map((order) => (
                    <tr key={order.id}>
                      <td><Link className="madar-table-link madar-code" to={`/workshop/${order.id}`}>{order.order_code}</Link></td>
                      <td>{order.client_name}</td><td>{order.product_name}</td>
                      <td>{machineNames[order.machine_type] ?? order.machine_type}</td>
                      <td>{formatDate(order.target_delivery_date)}</td>
                      <td><Badge status={order.status} /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <EmptyState icon="factory" title="الورشة هادئة حالياً" description="ابدأ أمراً جديداً لمتابعة مراحل الإنتاج هنا." />}
            </section>
          </div>
          <div className="madar-dashboard-note"><Icon name="shield" size={14} /> بيانات اللوحة مباشرة من واجهات MADAR V2 المحلية.</div>
        </>
      )}
    </>
  );
}
