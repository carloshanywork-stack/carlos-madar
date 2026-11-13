import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';

function queryString(from, to, reasonId, month) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (reasonId) query.set('reasonId', reasonId);
  if (month) query.set('month', month);
  return query.toString();
}

export default function MaintenanceAreaAnalysis({ month = '' }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reasonId, setReasonId] = useState('');
  useEffect(() => { setFrom(''); setTo(''); }, [month]);
  const search = queryString(month ? '' : from, month ? '' : to, reasonId, month);
  const path = `/api/maintenance/analysis/areas${search ? `?${search}` : ''}`;
  const { data: areas, loading, error } = useApi(path);
  const { data: reasons } = useApi('/api/maintenance/reasons');

  const totals = useMemo(() => (areas ?? []).reduce((sum, area) => ({
    total: sum.total + area.total_count,
    completed: sum.completed + area.completed_count,
    missing: sum.missing + area.missing_count,
  }), { total: 0, completed: 0, missing: 0 }), [areas]);

  function downloadMaintenanceExcel() {
    const query = queryString(month ? '' : from, month ? '' : to, reasonId, month);
    window.location.href = `/api/maintenance/analysis/export.xlsx${query ? `?${query}` : ''}`;
  }

  return (
    <section className="madar-section madar-area-analysis">
      <div className="madar-section-head">
        <div>
          <h2 className="madar-section-title">تحليل الأرشيف والمناطق</h2>
          <div className="madar-section-note">تُحسب الماكينة منجزة عند وجود بطاقة مكتملة لها في أمر صيانة مؤرشف ضمن الفلاتر المحددة.</div>
        </div>
        <Button icon="file" variant="secondary" onClick={downloadMaintenanceExcel}>
          تصدير إكسيل تقرير الصيانة والأعطال (Excel)
        </Button>
      </div>

      <div className="madar-analysis-filters">
        <Input label="من تاريخ الخدمة" type="date" disabled={Boolean(month)} value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input label="إلى تاريخ الخدمة" type="date" disabled={Boolean(month)} value={to} onChange={(event) => setTo(event.target.value)} />
        <Select label="سبب العطل" value={reasonId} onChange={(event) => setReasonId(event.target.value)}>
          <option value="">كل الأسباب</option>
          {(reasons ?? []).map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
        </Select>
      </div>

      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      {loading ? <div className="madar-section"><LoadingState label="جارٍ تحليل إنجاز الصيانة حسب المنطقة" /></div> : error ? null : <>
        <div className="madar-analysis-summary madar-section" aria-label="ملخص إنجاز الصيانة">
          <article className="madar-analysis-metric"><span>إجمالي الماكينات</span><strong>{totals.total.toLocaleString('ar-EG')}</strong></article>
          <article className="madar-analysis-metric"><span>الماكينات المنجزة</span><strong>{totals.completed.toLocaleString('ar-EG')}</strong></article>
          <article className="madar-analysis-metric"><span>الماكينات المتبقية</span><strong>{totals.missing.toLocaleString('ar-EG')}</strong></article>
        </div>

        {areas?.length ? <div className="madar-analysis-areas madar-section">
          {areas.map((area) => {
            const percent = Math.min(100, Math.max(0, Math.round(area.completion_ratio * 100)));
            const complete = area.missing_count === 0;
            return (
              <article className="madar-area-progress-card" key={area.area}>
                <div className="madar-area-progress-heading">
                  <h3>{area.area}</h3>
                  <Badge tone={complete ? 'success' : 'warning'}>{percent}%</Badge>
                </div>
                <div className="madar-area-progress-track" role="progressbar" aria-label={`نسبة إنجاز ${area.area}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
                  <div className={`madar-area-progress-fill ${complete ? 'complete' : ''}`} style={{ width: `${percent}%` }} />
                </div>
                <div className="madar-area-progress-count">
                  <span><strong>{area.completed_count.toLocaleString('ar-EG')} من {area.total_count.toLocaleString('ar-EG')}</strong> ماكينة أُنجزت</span>
                  <span>{area.missing_count.toLocaleString('ar-EG')} متبقية</span>
                </div>
                {area.missing_count > 0 && <details className="madar-area-missing">
                  <summary>عرض الماكينات المتبقية ({area.missing_count})</summary>
                  <ul className="madar-area-missing-list">
                    {area.missing_machines.map((machine) => <li key={machine.id}><span>{machine.name_ar}</span><span className="madar-code">{machine.code}</span></li>)}
                  </ul>
                </details>}
                {complete && <p className="madar-small madar-muted">اكتملت تغطية ماكينات المنطقة ضمن الفلاتر المحددة.</p>}
              </article>
            );
          })}
        </div> : <div className="madar-section"><EmptyState icon="chart" title="لا توجد ماكينات ضمن التحليل" description="غيّر الفترة أو تحقق من دليل الماكينات النشطة." /></div>}
      </>}
    </section>
  );
}
