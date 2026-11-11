import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const coordinates = (point) => point ? `${point.latitude}, ${point.longitude}` : 'غير معتمد';

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
      if (['rep.machine.location-requested', 'rep.machine.location-reviewed'].includes(event.detail?.type)) void refresh();
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
  return <section className="supervisor-panel" aria-label="مراجعة مواقع الماكينات">
    <h2>اعتماد مواقع الماكينات ({requests.length})</h2>
    <button type="button" onClick={() => void refresh()}>تحديث الطلبات</button>
    {error && <p role="alert">{error}</p>}
    {!requests.length && <p>لا توجد مقترحات موقع معلقة.</p>}
    {requests.map((request) => <article key={request.id}>
      <h3>{request.machineCode} · {request.machineName}</h3>
      <p>المندوب: {request.representativeName} · الطلب #{request.id}</p>
      <p>الموقع المعتمد: <bdi>{coordinates(request.approvedLocation)}</bdi></p>
      <p>الموقع المقترح: <bdi>{coordinates(request.proposedLocation)}</bdi> · دقة ±{request.proposedLocation.accuracy} متر</p>
      <p>{request.proposedLocation.updatedAt}</p>
      <label>ملاحظة القرار<input maxLength={2000} value={notes[request.id] ?? ''}
        onChange={(event) => setNotes({ ...notes, [request.id]: event.target.value })} /></label>
      <button type="button" disabled={busy !== null} onClick={() => void decide(request, 'approve')}>اعتماد الموقع</button>
      <button type="button" disabled={busy !== null} onClick={() => void decide(request, 'reject')}>رفض المقترح</button>
    </article>)}
  </section>;
}
