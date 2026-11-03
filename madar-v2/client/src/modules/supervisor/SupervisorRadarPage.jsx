import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import './supervisor-radar.css';

const STATUS = {
  active: { label: 'على المسار', color: '#168569' },
  onsite: { label: 'في موقع صيانة', color: '#d3931b' },
  offline: { label: 'أوفلاين / خارج التغطية', color: '#88939d' },
};

function formatTime(value) {
  if (!value) return 'لا توجد إشارة مسجلة';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'غير معروف';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'غير متاح';
  if (seconds < 60) return `${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} س ` : ''}${minutes % 60} د`;
}

function TrackMap({ representatives, selectedId, onSelect }) {
  const positions = representatives.flatMap((rep) => rep.trail?.length ? rep.trail : rep.lastLocation ? [rep.lastLocation] : []);
  const bounds = useMemo(() => {
    if (!positions.length) return { minLat: 24, maxLat: 26, minLon: 45, maxLon: 48 };
    const lats = positions.map((point) => point.latitude);
    const lons = positions.map((point) => point.longitude);
    const latSpan = Math.max(Math.max(...lats) - Math.min(...lats), 0.015);
    const lonSpan = Math.max(Math.max(...lons) - Math.min(...lons), 0.015);
    return {
      minLat: Math.min(...lats) - latSpan * 0.15,
      maxLat: Math.max(...lats) + latSpan * 0.15,
      minLon: Math.min(...lons) - lonSpan * 0.15,
      maxLon: Math.max(...lons) + lonSpan * 0.15,
    };
  }, [positions]);
  const point = (location) => ({
    x: 44 + ((location.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 812,
    y: 40 + ((bounds.maxLat - location.latitude) / (bounds.maxLat - bounds.minLat)) * 412,
  });

  return (
    <div className="radar-map-wrap">
      <svg className="radar-map" viewBox="0 0 900 500" role="img" aria-label="مسارات GPS للمندوبين على شبكة إحداثيات محلية">
        <defs>
          <pattern id="radar-grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#dce5e5" strokeWidth="1" />
          </pattern>
          <pattern id="radar-minor-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#edf1f0" strokeWidth=".7" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="900" height="500" fill="#f7faf8" />
        <rect x="0" y="0" width="900" height="500" fill="url(#radar-minor-grid)" />
        <rect x="0" y="0" width="900" height="500" fill="url(#radar-grid)" />
        <path d="M0 375 C180 330 245 404 415 350 S690 287 900 325" fill="none" stroke="#e2e9e5" strokeWidth="24" />
        <path d="M90 0 C130 145 210 231 190 500 M570 0 C520 151 630 324 590 500 M0 130 C230 165 420 120 900 183" fill="none" stroke="#fff" strokeWidth="10" />
        <path d="M90 0 C130 145 210 231 190 500 M570 0 C520 151 630 324 590 500 M0 130 C230 165 420 120 900 183" fill="none" stroke="#e2e9e5" strokeWidth="1.2" />
        <text x="18" y="481" className="radar-map-caption">مخطط إحداثي محلي · لا تُرسل بيانات الموقع إلى مزوّد خرائط خارجي</text>
        {!positions.length && <text x="450" y="250" textAnchor="middle" className="radar-map-empty">بانتظار أول إشارة GPS</text>}
        {representatives.map((rep) => {
          const points = rep.trail?.length ? rep.trail : rep.lastLocation ? [rep.lastLocation] : [];
          const status = STATUS[rep.status] ?? STATUS.offline;
          const xy = points.map(point);
          const last = xy.at(-1);
          if (!last) return null;
          const line = xy.map((item) => `${item.x},${item.y}`).join(' ');
          return (
            <g key={rep.id} className="radar-map-rep" onClick={() => onSelect(rep.id)} role="button" tabIndex="0" aria-label={`عرض ${rep.fullName}`}>
              {xy.length > 1 && <polyline points={line} fill="none" stroke={status.color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity=".73" />}
              {xy.filter((_, index) => index % Math.max(1, Math.ceil(xy.length / 18)) === 0).map((stop, index) => (
                <circle key={`${rep.id}-trail-${index}`} cx={stop.x} cy={stop.y} r="2.7" fill={status.color} opacity=".48" />
              ))}
              <circle cx={last.x} cy={last.y} r="13" fill={status.color} opacity=".15" />
              <circle cx={last.x} cy={last.y} r="7" fill={status.color} stroke="#fff" strokeWidth="2.5" />
              <rect x={last.x - 30} y={last.y - 33} width="60" height="19" rx="8" fill="#173148" />
              <text x={last.x} y={last.y - 20} textAnchor="middle" className="radar-map-name">{rep.fullName.slice(0, 12)}</text>
              {selectedId === rep.id && <circle cx={last.x} cy={last.y} r="17" fill="none" stroke="#183a53" strokeWidth="1.5" strokeDasharray="3 3" />}
            </g>
          );
        })}
      </svg>
      <div className="radar-coordinate-legend"><span>خط العرض {bounds.minLat.toFixed(3)}° – {bounds.maxLat.toFixed(3)}°</span><span>خط الطول {bounds.minLon.toFixed(3)}° – {bounds.maxLon.toFixed(3)}°</span></div>
    </div>
  );
}

export default function SupervisorRadarPage() {
  const [radar, setRadar] = useState(null);
  const [visits, setVisits] = useState([]);
  const [selectedRep, setSelectedRep] = useState(null);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [reviewNotes, setReviewNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyVisit, setBusyVisit] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [radarData, queueData] = await Promise.all([
        api.get('/api/supervisor/radar'),
        api.get('/api/supervisor/qa/queue'),
      ]);
      setRadar(radarData);
      setVisits(queueData.visits ?? []);
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحميل بيانات الرادار والمراجعة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const representatives = radar?.representatives ?? [];
  const focusedRep = representatives.find((rep) => rep.id === selectedRep) ?? null;

  const review = async (visit, action) => {
    const reviewNote = reviewNotes[visit.id] ?? '';
    setBusyVisit(visit.id);
    setError('');
    try {
      const result = await api.post(`/api/supervisor/visits/${visit.id}/review`, {
        action,
        note: action === 'reshoot' ? reviewNote.trim() : reviewNote.trim() || undefined,
      });
      setVisits((current) => current.filter((item) => item.id !== visit.id));
      setReviewNotes((current) => { const next = { ...current }; delete next[visit.id]; return next; });
      setSelectedVisit(null);
      setNotice(result.status === 'approved' ? `اعتُمدت زيارة الماكينة ${visit.machineCode}.` : `أُرسل طلب إعادة التصوير للمندوب ${visit.repName}.`);
      window.setTimeout(() => setNotice(''), 4500);
      void refresh();
    } catch (requestError) {
      setError(requestError.message || 'تعذر حفظ قرار المراجعة.');
    } finally {
      setBusyVisit(null);
    }
  };

  const mapStatus = focusedRep ? STATUS[focusedRep.status] ?? STATUS.offline : null;

  return (
    <div className="supervisor-page" dir="rtl">
      <header className="supervisor-page-head">
        <div>
          <span className="supervisor-eyebrow">FIELD OPERATIONS · SUPERVISOR</span>
          <h1>رادار الإشراف الميداني</h1>
          <p>متابعة إشارات الوردية ومراجعة صور الزيارات قبل اعتمادها للتقارير.</p>
        </div>
        <div className="supervisor-head-actions">
          <a className="supervisor-export" href="/api/supervisor/reports/approved-visits.xlsx">تنزيل Excel المعتمد ↓</a>
          <button className="supervisor-refresh" type="button" onClick={() => { setLoading(true); void refresh(); }}>تحديث الرادار ↻</button>
        </div>
      </header>

      {error && <div className="supervisor-alert" role="alert">{error}</div>}
      {notice && <div className="supervisor-notice" role="status">✓ {notice}</div>}

      <section className="supervisor-kpis" aria-label="ملخص الوردية">
        <article><span>المناديب المسجلون</span><strong>{representatives.length}</strong><small>حسابات ميدانية فعالة أو محفوظة</small></article>
        <article><span>على المسار الآن</span><strong>{representatives.filter((rep) => rep.status === 'active').length}</strong><small>إشارة حديثة ووردية مفتوحة</small></article>
        <article><span>في موقع صيانة</span><strong>{representatives.filter((rep) => rep.status === 'onsite').length}</strong><small>زيارة تنتظر الفحص الميداني</small></article>
        <article className="qa-kpi"><span>طابور مراجعة الصور</span><strong>{visits.length}</strong><small>لا تدخل التقارير قبل الاعتماد</small></article>
      </section>

      <div className="supervisor-main-grid">
        <section className="supervisor-panel radar-panel">
          <div className="supervisor-panel-head">
            <div><span className="supervisor-eyebrow">GPS · LAST SIGNAL</span><h2>الخريطة ومسارات اليوم</h2></div>
            <span className="live-pill"><i /> يتحدث كل 15 ثانية</span>
          </div>
          <TrackMap representatives={representatives} selectedId={selectedRep} onSelect={setSelectedRep} />
          <div className="radar-below">
            <div className="radar-rep-list">
              {representatives.map((rep) => {
                const status = STATUS[rep.status] ?? STATUS.offline;
                return <button className={`radar-rep-row ${selectedRep === rep.id ? 'selected' : ''}`} key={rep.id} type="button" onClick={() => setSelectedRep(rep.id)}>
                  <i style={{ '--rep-status': status.color }} />
                  <span><strong>{rep.fullName}</strong><small>{status.label} · {rep.assignedRegions.join('، ') || 'دون منطقة مسندة'}</small></span>
                  <b>{rep.distanceKm.toFixed(1)} كم</b>
                </button>;
              })}
              {!representatives.length && <p className="supervisor-empty-small">لا توجد حسابات مندوبين حتى الآن.</p>}
            </div>
            {focusedRep && <aside className="radar-rep-details">
              <div className="rep-details-title"><span className="rep-avatar">{focusedRep.fullName.slice(0, 1)}</span><div><strong>{focusedRep.fullName}</strong><small style={{ color: mapStatus?.color }}>{mapStatus?.label}</small></div></div>
              <dl>
                <div><dt>الهاتف</dt><dd dir="ltr">{focusedRep.phone || 'غير مسجل'}</dd></div>
                <div><dt>المناطق</dt><dd>{focusedRep.assignedRegions.join('، ') || '—'}</dd></div>
                <div><dt>زيارات معتمدة اليوم</dt><dd>{focusedRep.completedToday}</dd></div>
                <div><dt>بانتظار المراجعة</dt><dd>{focusedRep.pendingReview}</dd></div>
                <div><dt>المسافة التقديرية</dt><dd>{focusedRep.distanceKm.toFixed(1)} كم</dd></div>
                <div><dt>آخر إشارة GPS</dt><dd>{formatTime(focusedRep.lastSignal)}</dd></div>
                <div><dt>بداية الوردية</dt><dd>{formatTime(focusedRep.dutyStartedAt)}</dd></div>
              </dl>
              <p className="estimate-note">المسافة تقديرية من نقاط GPS ذات دقة مناسبة؛ قد تتأثر بالتغطية أو التلاعب بالجهاز ولا تصلح وحدها لإثبات بدل انتقال.</p>
            </aside>}
          </div>
          {loading && <div className="supervisor-loading">جارٍ تحديث بيانات المندوبين…</div>}
        </section>

        <section className="supervisor-panel qa-panel">
          <div className="supervisor-panel-head">
            <div><span className="supervisor-eyebrow">QUALITY ASSURANCE · BEFORE REPORTS</span><h2>طابور اعتماد الزيارات</h2></div>
            <span className="queue-count">{visits.length}</span>
          </div>
          {!visits.length ? <div className="supervisor-qa-empty"><span>✓</span><strong>لا توجد زيارات تنتظر المراجعة</strong><small>ستظهر هنا الزيارات بعد مزامنتها من تطبيق المندوب.</small></div> : (
            <div className="qa-visit-list">
              {visits.map((visit) => <article className="qa-visit-card" key={visit.id}>
                <div className="qa-visit-heading">
                  <div><span className="qa-machine-code" dir="ltr">{visit.machineCode}</span><h3>{visit.machineName}</h3><p>{visit.regionName} · {visit.orderCode}</p></div>
                  <span className="qa-pending-badge">بانتظار الاعتماد</span>
                </div>
                <div className="qa-photo-pair">
                  <button type="button" onClick={() => setSelectedVisit({ ...visit, zoomPhoto: 'before' })} aria-label="تكبير صورة قبل الصيانة"><img src={visit.beforePhotoUrl} alt={`قبل الصيانة ${visit.machineCode}`} /><span>قبل الصيانة ↗</span></button>
                  <button type="button" onClick={() => setSelectedVisit({ ...visit, zoomPhoto: 'after' })} aria-label="تكبير صورة بعد الصيانة"><img src={visit.afterPhotoUrl} alt={`بعد الصيانة ${visit.machineCode}`} /><span>بعد الصيانة ↗</span></button>
                </div>
                <div className="qa-visit-meta">
                  <span>المندوب <b>{visit.repName}</b></span>
                  <span>حالة الماكينة <b>{visit.machineCondition === 'faulty' ? 'عطلانة' : visit.machineCondition === 'preventive_maintenance' ? 'صيانة وقائية' : 'تعمل'}</b></span>
                  <span>المدة بين الصورتين <b>{formatDuration(visit.siteDurationSeconds)}</b></span>
                  <span>الرفع <b>{formatTime(visit.capturedAt)}</b></span>
                </div>
                <div className="qa-reasons"><strong>أسباب الصيانة</strong><span>{visit.reasonNames.length ? visit.reasonNames.join('، ') : 'لم يُحدد سبب'}</span></div>
                {visit.notes && <p className="qa-rep-note"><strong>ملاحظة المندوب:</strong> {visit.notes}</p>}
                <label className="qa-review-note"><span>ملاحظة المراجعة <small>مطلوبة عند طلب إعادة التصوير</small></span><textarea value={reviewNotes[visit.id] ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [visit.id]: event.target.value }))} placeholder="مثال: أعد تصوير اللوحة من زاوية أوضح مع إضاءة كافية" maxLength={1000} rows={2} /></label>
                <div className="qa-actions">
                  <button type="button" className="qa-approve" disabled={busyVisit === visit.id} onClick={() => void review(visit, 'approve')}>اعتماد الزيارة ✓</button>
                  <button type="button" className="qa-reshoot" disabled={busyVisit === visit.id || !(reviewNotes[visit.id] ?? '').trim()} onClick={() => void review(visit, 'reshoot')}>طلب إعادة تصوير ↻</button>
                </div>
              </article>)}
            </div>
          )}
        </section>
      </div>

      {selectedVisit?.zoomPhoto && <div className="qa-zoom-backdrop" role="presentation" onClick={() => setSelectedVisit(null)}>
        <section role="dialog" aria-modal="true" aria-label="تكبير صورة الزيارة" onClick={(event) => event.stopPropagation()}>
          <header><strong>ماكينة {selectedVisit.machineCode} · {selectedVisit.zoomPhoto === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}</strong><button type="button" onClick={() => setSelectedVisit(null)} aria-label="إغلاق">×</button></header>
          <img src={selectedVisit.zoomPhoto === 'before' ? selectedVisit.beforePhotoUrl : selectedVisit.afterPhotoUrl} alt={`صورة ${selectedVisit.zoomPhoto} للماكينة ${selectedVisit.machineCode}`} />
        </section>
      </div>}
    </div>
  );
}
