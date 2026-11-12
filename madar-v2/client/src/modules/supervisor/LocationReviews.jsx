import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const coordinates = (point) => point ? `${point.latitude}, ${point.longitude}` : 'غير معتمد';
const relativeTime = (value) => {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsed)) return 'الوقت غير معروف';
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
};

export default function LocationReviews() {
  const [requests, setRequests] = useState([]);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const result = await api.get('/api/supervisor/location-confirmations');
      setRequests(result.requests);
      setError('');
    } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    const onEvent = (event) => {
      if (['system.reconcile-required', 'rep.machine.location-requested', 'rep.machine.location-reviewed'].includes(event.detail?.type)) void refresh();
    };
    window.addEventListener('madar:operations-event', onEvent);
    return () => { window.clearInterval(timer); window.removeEventListener('madar:operations-event', onEvent); };
  }, [refresh]);
  const decide = async (request, decision) => {
    setBusy(request.id);
    try {
      await api.post(`/api/supervisor/corrections/${request.id}/${decision}`, { note: notes[request.id]?.trim() || undefined });
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };
  return <section className="location-reviews-panel" aria-label="مراجعة مواقع الماكينات">
    <header className="location-reviews-header"><div><span className="location-reviews-eyebrow">LOCATION QA · GEOFENCE APPROVALS</span><h2>مراجعة مواقع الماكينات</h2></div><span className="location-reviews-count">{requests.length}</span><button type="button" className="location-reviews-refresh" onClick={() => void refresh()}>تحديث الطلبات</button></header>
    {error && <p className="location-reviews-error" role="alert">{error}</p>}
    {!requests.length && <p className="location-reviews-empty">لا توجد مقترحات موقع معلقة.</p>}
    <div className="location-review-list">{requests.map((request) => <article className="location-review-card" key={request.id}>
      <div className="location-review-card-head"><div><h3>{request.machineCode} · {request.machineName}</h3><p>المندوب <strong>{request.representativeName}</strong> <span>· طلب #{request.id} · {relativeTime(request.proposedLocation.updatedAt)}</span></p></div><span className="location-review-accuracy">±{Math.round(Number(request.proposedLocation.accuracy) || 0)}م</span></div>
      <div className="location-review-comparison"><div><small>الموقع المعتمد الحالي</small><bdi>{coordinates(request.approvedLocation)}</bdi></div><div><small>الموقع المقترح من المندوب</small><bdi>{coordinates(request.proposedLocation)}</bdi></div></div>
      <label className="location-review-note">ملاحظة القرار<input maxLength={2000} value={notes[request.id] ?? ''}
        onChange={(event) => setNotes({ ...notes, [request.id]: event.target.value })} /></label>
      <div className="location-review-actions"><button type="button" className="location-review-approve" disabled={busy !== null} onClick={() => void decide(request, 'approve')}>اعتماد الموقع</button><button type="button" className="location-review-reject" disabled={busy !== null} onClick={() => void decide(request, 'reject')}>رفض المقترح</button></div>
    </article>)}</div>
  </section>;
}
