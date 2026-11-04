import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage, formatDate } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';

export default function MachineCorrectionReview({ onToast }) {
  const [status, setStatus] = useState('pending');
  const { data, loading, error, reload } = useApi(`/api/maintenance/machine-corrections?status=${status}`);
  const [choices, setChoices] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [actionError, setActionError] = useState('');
  const corrections = data?.corrections ?? [];
  const [codeCandidateChecks, setCodeCandidateChecks] = useState({});

  useEffect(() => {
    setChoices((current) => {
      const next = { ...current };
      for (const correction of corrections) {
        const existingChoice = correction.duplicateCandidates.find((candidate) => candidate.id !== correction.machine_id
          && candidate.active && candidate.matches_reported_code)?.id;
        if (!(correction.id in next)) next[correction.id] = {
          machineId: existingChoice ? String(existingChoice) : '',
          approvedCode: correction.reported_code,
          note: '',
        };
      }
      return next;
    });
  }, [corrections]);

  async function checkCodeCandidates(correction, code) {
    const checkedCode = String(code ?? '').trim();
    if (!checkedCode) return null;
    const result = await api.get(`/api/maintenance/machine-corrections/${correction.id}/candidates?code=${encodeURIComponent(checkedCode)}`);
    setCodeCandidateChecks((current) => ({ ...current, [correction.id]: result }));
    return result;
  }

  async function review(correction, action) {
    setSavingId(correction.id);
    setActionError('');
    try {
      const choice = choices[correction.id] ?? {};
      const approvedCode = String(choice.approvedCode || correction.reported_code).trim();
      let selectedCandidates;
      if (action === 'approved' && approvedCode.toLocaleLowerCase('en') === correction.reported_code.toLocaleLowerCase('en')) {
        selectedCandidates = {
          hasConflict: correction.codeConflict,
          candidates: correction.duplicateCandidates.map((candidate) => ({
            ...candidate,
            matches_code: candidate.matches_reported_code,
          })),
        };
      } else if (action === 'approved') {
        selectedCandidates = await checkCodeCandidates(correction, approvedCode);
      }
      const validSelectedCandidate = selectedCandidates?.candidates?.some((candidate) => (
        candidate.active && candidate.matches_code && String(candidate.id) === String(choice.machineId)
        && candidate.id !== correction.machine_id
      ));
      if (action === 'approved' && selectedCandidates?.hasConflict && !validSelectedCandidate) {
        throw new Error('هذا الكود مستخدم أو مطلوب لماكينة أخرى. اربط البلاغ بالسجل النشط المطابق، أو أدخل كوداً فريداً.');
      }
      const result = await api.patch(`/api/maintenance/machine-corrections/${correction.id}/review`, {
        action,
        resolvedMachineId: action === 'approved' && validSelectedCandidate ? Number(choice.machineId) : null,
        approvedCode: action === 'approved' ? approvedCode : undefined,
        note: choice.note || undefined,
      });
      await reload();
      onToast?.(action === 'approved'
        ? result.renamed
          ? 'تم اعتماد التصحيح وتحديث الكود والاسم مع الحفاظ على معرّف الماكينة وروابطها وأدلتها.'
          : 'تم اعتماد البلاغ وحفظ قرار الربط دون دمج سجلات أو تغيير تاريخها.'
        : 'تم رفض البلاغ مع الاحتفاظ به وبأدلته في سجل المراجعة.');
      return result;
    } catch (caught) {
      setActionError(errorMessage(caught));
      return null;
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="madar-machine-corrections" aria-label="مراجعة بلاغات تصحيح الماكينات">
      <div className="madar-machine-corrections-heading">
        <div><strong>مراجعة بلاغات الماكينات</strong><small>الكود والاسم يتغيران للماكينة نفسها فقط إذا كان الكود فريداً؛ لا دمج ولا نقل للعلاقات بين سجلات مختلفة.</small></div>
        <Select label="حالة البلاغ" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="pending">بانتظار المراجعة</option>
          <option value="all">كل البلاغات</option>
          <option value="approved">المعتمدة</option>
          <option value="rejected">المرفوضة</option>
        </Select>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {loading ? <LoadingState label="جارٍ تحميل بلاغات تصحيح الماكينات" /> : corrections.length ? (
        <div className="madar-machine-correction-list">
          {corrections.map((correction) => {
            const choice = choices[correction.id] ?? { machineId: '', note: '' };
            const pending = correction.status === 'pending';
            const approvedCode = String(choice.approvedCode ?? correction.reported_code).trim();
            const sameAsReportedCode = approvedCode.toLocaleLowerCase('en') === correction.reported_code.toLocaleLowerCase('en');
            const checkedCandidates = codeCandidateChecks[correction.id];
            const currentCodeCheck = sameAsReportedCode
              ? {
                hasConflict: correction.codeConflict,
                candidates: correction.duplicateCandidates.map((candidate) => ({
                  ...candidate,
                  matches_code: candidate.matches_reported_code,
                })),
              }
              : checkedCandidates?.code?.toLocaleLowerCase('en') === approvedCode.toLocaleLowerCase('en')
                ? checkedCandidates : null;
            const candidateOptions = currentCodeCheck?.candidates ?? [];
            const hasValidSelectedCandidate = candidateOptions.some((candidate) => (
              candidate.active && candidate.matches_code && String(candidate.id) === String(choice.machineId)
              && candidate.id !== correction.machine_id
            ));
            return <article className="madar-machine-correction-card" key={correction.id}>
              <header>
                <div><span className="madar-code">بلاغ #{correction.id}</span><span className={`madar-correction-status ${correction.status}`}>{correction.status === 'pending' ? 'بانتظار المراجعة' : correction.status === 'approved' ? 'معتمد' : 'مرفوض'}</span></div>
                <small>{formatDate(correction.created_at)} · {correction.representative_name}</small>
              </header>
              {(correction.codeConflict || currentCodeCheck?.hasConflict) && <Alert tone="warning">
                تعارض كود: {approvedCode} مستخدم أو مطلوب لماكينة أخرى. اربط البلاغ بسجل قائم مطابق، أو أدخل كوداً فريداً، أو ارفضه؛ لن يتم دمج أي سجل.
              </Alert>}
              <dl>
                <div><dt>الموقع المسند حالياً</dt><dd><b dir="ltr">{correction.current_machine_code}</b> · {correction.current_machine_name} · {correction.current_machine_area} · أمر {correction.order_code}</dd></div>
                <div><dt>المعلومات التي أبلغ عنها المندوب</dt><dd><b dir="ltr">{correction.reported_code}</b> · {correction.reported_name}</dd></div>
                <div><dt>موقع GPS وقت البلاغ</dt><dd dir="ltr">{Number(correction.location?.latitude).toFixed(6)}, {Number(correction.location?.longitude).toFixed(6)} · ±{Math.round(Number(correction.location?.accuracy) || 0)}م</dd></div>
                <div><dt>وقت الالتقاط</dt><dd>{formatDate(correction.captured_at)}</dd></div>
                {correction.note && <div className="full"><dt>ملاحظة المندوب</dt><dd>{correction.note}</dd></div>}
                {correction.review_note && <div className="full"><dt>قرار المراجع · {correction.reviewer_name || 'الإدارة'}</dt><dd>{correction.review_note || '—'}{correction.resolved_machine_id ? ` · سجل الماكينة #${correction.resolved_machine_id}` : ''}{correction.approved_code ? ` · الكود المعتمد ${correction.approved_code}` : ''}</dd></div>}
              </dl>
              {correction.has_evidence && <a className="madar-correction-evidence" href={correction.evidenceUrl} target="_blank" rel="noreferrer">
                <img src={correction.evidenceUrl} alt={`صورة إثبات البلاغ رقم ${correction.id}`} loading="lazy" />
                <span>فتح صورة الإثبات الأصلية · {correction.evidence_content_type}</span>
              </a>}
              {(correction.codeConflict || currentCodeCheck?.hasConflict) && <div className="madar-correction-candidates">
                <strong>السجلات المرشحة للكود {approvedCode}</strong>
                  <ul>{candidateOptions.map((candidate) => <li key={candidate.id}>
                   <span><b dir="ltr">{candidate.code}</b> · {candidate.name_ar} · {candidate.area}{!candidate.active && ' · غير نشطة'}</span>
                   {pending && candidate.active && candidate.id !== correction.machine_id && candidate.matches_code && <label><input type="radio" name={`correction-${correction.id}`} value={candidate.id}
                     checked={String(candidate.id) === String(choice.machineId)}
                     onChange={() => setChoices((current) => ({ ...current, [correction.id]: { ...choice, machineId: String(candidate.id) } }))} /> هذا السجل</label>}
                </li>)}</ul>
                {pending && !candidateOptions.some((candidate) => candidate.active && candidate.id !== correction.machine_id && candidate.matches_code) && <Alert tone="warning">لا يوجد سجل نشط آخر مطابق لهذا الكود يمكن ربطه به. أدخل كوداً جديداً غير مستخدم أو ارفض البلاغ.</Alert>}
              </div>}
              {pending ? <>
                <Input label="الكود المعتمد (يمكن تعديله قبل الاعتماد)" dir="ltr" maxLength={64} value={choice.approvedCode ?? correction.reported_code}
                  onBlur={(event) => {
                    if (event.target.value.trim().toLocaleLowerCase('en') !== correction.reported_code.toLocaleLowerCase('en')) {
                      void checkCodeCandidates(correction, event.target.value).catch(() => {});
                    }
                  }}
                  onChange={(event) => setChoices((current) => ({
                    ...current,
                    [correction.id]: { ...choice, approvedCode: event.target.value, machineId: '' },
                  }))} />
                <Textarea label="ملاحظة قرار الإدارة (اختياري)" rows={2} maxLength={2000} value={choice.note}
                  onChange={(event) => setChoices((current) => ({ ...current, [correction.id]: { ...choice, note: event.target.value } }))} />
                <div className="madar-form-actions">
                  <Button variant="secondary" onClick={() => void review(correction, 'rejected')} disabled={savingId === correction.id}>{savingId === correction.id ? 'جارٍ الحفظ…' : 'رفض مع الاحتفاظ بالسجل'}</Button>
                  <Button onClick={() => void review(correction, 'approved')} disabled={savingId === correction.id || (currentCodeCheck?.hasConflict && !hasValidSelectedCandidate)}>{savingId === correction.id ? 'جارٍ الحفظ…' : 'اعتماد البلاغ'}</Button>
                </div>
              </> : correction.resolved_machine_id && <p className="madar-muted">قرار الربط المسجل: سجل الماكينة #{correction.resolved_machine_id}. لم يتم الدمج أو تعديل الماكينة.</p>}
            </article>;
          })}
        </div>
      ) : <EmptyState icon="factory" title="لا توجد بلاغات بهذه الحالة" description={status === 'pending' ? 'ستظهر هنا بلاغات المندوبين الجديدة مع موقع GPS وصورة الإثبات إن وُجدت.' : 'لم تُسجل بلاغات تصحيح بعد.'} />}
    </section>
  );
}
