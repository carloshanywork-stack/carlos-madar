import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { errorMessage } from '../../lib/format.js';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Icon from '../../components/ui/Icon.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Alert from '../../components/ui/Alert.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';

const maintenanceNames = {
  in_progress: 'قيد التنفيذ',
  review: 'مراجعة',
};
const machineNames = { cnc_router: 'CNC Router', laser: 'Laser', both: 'CNC + Laser', manual: 'يدوي' };

export default function OverviewPage() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
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
      const maintenanceDetails = await Promise.all(recentMaintenance.map(async (order) => {
        try { return await api.get(`/api/maintenance/orders/${order.id}`); } catch { return { ...order, cards: [] }; }
      }));
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
  }, []);
  useEffect(() => { load(); }, [load]);

  const lowStockCount = useMemo(() => dashboard?.materials?.filter((item) => item.is_low_stock).length ?? 0, [dashboard]);
  const kpis = dashboard ? [
    { label: 'العملاء النشطون', value: dashboard.clients.length, foot: 'ملفات العملاء المسجلة', icon: 'users', to: '/clients', tone: 'teal' },
    { label: 'الصيانة الميدانية', value: dashboard.maintenance.length + dashboard.review.length, foot: `${dashboard.review.length} بانتظار المراجعة`, icon: 'wrench', to: '/maintenance', tone: 'blue' },
    { label: 'تشغيل الورشة', value: dashboard.production.length, foot: `${dashboard.ready.length} جاهز للتسليم`, icon: 'factory', to: '/workshop', tone: 'gold' },
    { label: 'المخزون والمواد', value: lowStockCount, foot: 'مواد عند حد إعادة الطلب', icon: 'boxes', to: '/warehouse', tone: 'rose' },
  ] : [];

  return (
    <>
      <PageHeader
        kicker="نظرة عامة · MADAR V2"
        title="صباح التشغيل الجيد"
        description="تابع حركة الصيانة والورشة والمخزون من مساحة عمل واحدة."
        actions={<button type="button" className="madar-button madar-button-secondary" onClick={load}><Icon name="refresh" size={14} /> تحديث البيانات</button>}
      />
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      {loading && !dashboard ? <LoadingState /> : (
        <>
          <div className="madar-grid madar-grid-4">
            {kpis.map((item) => (
              <Link to={item.to} className="madar-kpi-link" key={item.label}>
                <article className={`madar-panel madar-kpi madar-kpi-${item.tone}`}>
                  <div className="madar-kpi-top"><span className="madar-kpi-label">{item.label}</span><span className="madar-kpi-icon"><Icon name={item.icon} /></span></div>
                  <div className="madar-kpi-value">{item.value}</div>
                  <div className="madar-kpi-foot"><strong>{item.foot}</strong></div>
                </article>
              </Link>
            ))}
          </div>

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
