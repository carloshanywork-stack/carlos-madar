import { useApi } from '../../lib/useApi.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';

export default function AccountingPage() {
  const { data: treasury, loading, error } = useApi('/api/finance/treasury');
  const { data: employees } = useApi('/api/employees');
  return (
    <>
      <PageHeader kicker="المحاسبة · الكادر" title="المحاسبة والموظفون" description="دفتر حركة الخزينة المتاح وقائمة الموظفين النشطين في MADAR V2." />
      <div className="madar-integration-notice"><Alert tone="info">واجهة V2 الحالية تعرض سجل الخزينة، لكنها لا توفر بعد دفتر أستاذ مزدوج القيد أو واجهات حساب الرواتب والحضور. لن تُعرض أرصدة محاسبية أو أجور غير متاحة من الخادم.</Alert></div>
      <div className="madar-grid madar-grid-2 madar-section">
        <section className="madar-panel"><div className="madar-panel-header"><div><h2>دفتر النقدية</h2><p>آخر الحركات المسجلة في الخزينة (حد أقصى 100)</p></div><strong className="madar-money">{treasury ? formatMoney(treasury.cashBalanceCents) : '—'}</strong></div>{error && <div className="madar-panel-body"><Alert tone="error">{error}</Alert></div>}{loading && !treasury ? <LoadingState /> : treasury?.entries?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>التاريخ</th><th>التصنيف</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>{treasury.entries.slice(0, 12).map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td>{entry.category}</td><td><Badge tone={entry.kind === 'income' ? 'success' : 'danger'}>{entry.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td className="madar-money">{formatMoney(entry.amount_cents)}</td></tr>)}</tbody></table></div> : <EmptyState icon="wallet" title="لا توجد حركات خزينة" />}</section>
        <section className="madar-panel"><div className="madar-panel-header"><div><h2>الفريق النشط</h2><p>الأسماء والمسميات الوظيفية المسجلة</p></div><span className="madar-badge">{employees?.length ?? 0} موظف</span></div>{employees?.length ? <div className="madar-employee-directory">{employees.map((employee) => <div className="madar-employee-row" key={employee.id}><span className="madar-client-avatar small">{employee.name.slice(0, 1)}</span><span className="madar-employee-copy"><strong>{employee.name}</strong><small>{employee.job_title || employee.department}</small></span><Badge tone="info">{employee.department}</Badge></div>)}</div> : <EmptyState icon="users" title="لا يوجد موظفون نشطون" />}</section>
      </div>
      <div className="madar-panel madar-panel-pad madar-section"><span className="madar-page-kicker">مرحلة لاحقة</span><h2 className="madar-section-title">دفتر الأستاذ والرواتب</h2><p className="madar-page-description">سيتم تفعيل قيود الأستاذ وحساب الرواتب عندما يوفّر خادم V2 واجهات محاسبية معتمدة. حالياً تُسجل المقبوضات والمدفوعات في الخزينة والفواتير فقط.</p></div>
    </>
  );
}
