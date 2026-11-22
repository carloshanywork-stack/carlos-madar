import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage, formatDate } from '../../lib/format.js';
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
import { Select, Textarea } from '../../components/ui/Field.jsx';

const stageOptions = [
  { value: 'design_cam', label: 'تجهيز ملفات CAM والمسار' },
  { value: 'cnc_laser', label: 'تفريغ وتقطيع CNC وليزر' },
  { value: 'bending_assembly', label: 'ثني وتشكيل الحروف والأجناب' },
  { value: 'wiring_led', label: 'تثبيت وتوصيل ليدات الإضاءة' },
  { value: 'finishing', label: 'تشطيب وتجميع نهائي' },
  { value: 'qa_inspection', label: 'فحص واختبار الجودة الداخلي' },
  { value: 'site_installation', label: 'تركيب في موقع العميل' },
];

export default function TechnicianWorkspacePage() {
  const { data: jobs, loading, error, reload } = useApi('/api/workshop/technician/jobs');
  const [selectedJob, setSelectedJob] = useState(null);
  const [activeStage, setActiveStage] = useState('cnc_laser');
  const [stageNotes, setStageNotes] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { notice, showToast, clearToast } = useToast();

  useEffect(() => {
    let interval = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTimer = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  async function handleStageAction(action) {
    if (!selectedJob) return;
    setSubmitting(true);
    try {
      const durationMinutes = Math.max(1, Math.round(timerSeconds / 60));
      await api.post(`/api/workshop/orders/${selectedJob.id}/stage-log`, {
        stageName: activeStage,
        action,
        durationMinutes: action === 'complete' || action === 'pause' ? durationMinutes : 0,
        notes: stageNotes || undefined,
      });

      if (action === 'start') {
        setIsTimerRunning(true);
        showToast(`بدأ تشغيل مرحلة ${stageOptions.find((s) => s.value === activeStage)?.label}.`);
      } else if (action === 'pause') {
        setIsTimerRunning(false);
        showToast('تم إيقاف المؤقت مؤقتاً وتسجيل الوقت.');
      } else if (action === 'complete') {
        setIsTimerRunning(false);
        setTimerSeconds(0);
        setStageNotes('');
        showToast(`تم إتمام مرحلة ${stageOptions.find((s) => s.value === activeStage)?.label} بنجاح!`);
      }
      await reload();
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitQA(jobId) {
    if (!window.confirm('هل انتهيت من كافة مراحل التصنيع وترغب بإرسال الأمر لفحص الجودة النهائي؟')) return;
    setSubmitting(true);
    try {
      await api.post(`/api/workshop/orders/${jobId}/qa-submit`, {
        decision: 'approved',
        notes: 'تم إتمام التصنيع والتجميع وجاهز للاختبار.',
      });
      showToast('تم إرسال الأمر بنجاح لمراجعة واعتماد الجودة.');
      await reload();
    } catch (caught) {
      showToast(errorMessage(caught), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !jobs) return <LoadingState label="جارٍ تحميل مهام الورشة" />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="madar-stack">
      <PageHeader
        kicker="مساحة الفني"
        title="شغلي في الورشة"
        description="الأوامر المعينة لك، ملفات التصميم المتجهي، وتسجيل أوقات ومراحل التصنيع."
        actions={<Button variant="secondary" icon="refresh" onClick={reload}>تحديث المهام</Button>}
      />

      {jobs?.length === 0 ? (
        <EmptyState
          icon="check"
          title="لا توجد أوامر تشغيل معينة لك حالياً"
          description="عند إسناد أوامر ورشة لك من قِبل المشرف ستظهر هنا مباشرة."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 1.4fr)', gap: 20 }}>
          {/* Job List */}
          <div className="madar-stack">
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', fontWeight: 600 }}>أوامر التشغيل الجارية ({jobs.length})</h3>
            {jobs.map((job) => {
              const isSelected = selectedJob?.id === job.id;
              return (
                <div
                  key={job.id}
                  className={`madar-panel ${isSelected ? 'madar-panel-selected' : ''}`}
                  style={{
                    padding: 16,
                    cursor: 'pointer',
                    border: isSelected ? '2px solid var(--madar-primary, #2563eb)' : '1px solid var(--madar-border, #e2e8f0)',
                  }}
                  onClick={() => {
                    setSelectedJob(job);
                    if (selectedJob?.id !== job.id) {
                      setTimerSeconds(0);
                      setIsTimerRunning(false);
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span className="madar-code" style={{ fontWeight: 700 }}>{job.order_code}</span>
                    <Badge status={job.status} />
                  </div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: 'var(--madar-text-primary, #0f172a)' }}>
                    {job.product_name}
                  </h4>
                  <div style={{ fontSize: '0.85rem', color: 'var(--madar-text-secondary, #64748b)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>العميل: <strong>{job.client_name}</strong></span>
                    <span>موعد التسليم: <strong>{formatDate(job.target_delivery_date)}</strong></span>
                    <span>الملفات المتجهية: <strong>{job.designs?.length ?? 0} ملف</strong></span>
                    <span>الخامات المنصرفة: <strong>{job.materials?.length ?? 0} مادة</strong></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Job Execution Workbench */}
          <div>
            {selectedJob ? (
              <div className="madar-panel" style={{ padding: 20 }}>
                <div style={{ borderBottom: '1px solid var(--madar-border, #e2e8f0)', paddingBottom: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{selectedJob.product_name}</h3>
                    <span className="madar-code">{selectedJob.order_code}</span>
                  </div>
                  {selectedJob.description && (
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: 'var(--madar-text-secondary, #64748b)' }}>
                      {selectedJob.description}
                    </p>
                  )}
                </div>

                {/* Vector Designs Download */}
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>ملفات التصميم المتجهي (DXF / Laser)</h4>
                  {selectedJob.designs?.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {selectedJob.designs.map((file) => (
                        <a
                          key={file.id}
                          href={file.download_url}
                          target="_blank"
                          rel="noreferrer"
                          className="madar-button madar-button-secondary"
                          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
                        >
                          <Icon name="download" size={14} />
                          <span>{file.original_name}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>لم يتم إرفاق ملفات تصميم بعد.</p>
                  )}
                </div>

                {/* Stage Tracking & Stopwatch */}
                <div style={{ backgroundColor: 'var(--madar-surface-subtle, #f8fafc)', padding: 16, borderRadius: 8, marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="clock" size={16} />
                    <span>تسجيل وقت المرحلة والتشغيل</span>
                  </h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <Select
                      label="المرحلة الإنتاجية"
                      value={activeStage}
                      onChange={(e) => setActiveStage(e.target.value)}
                    >
                      {stageOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Select>

                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0f172a', color: '#38bdf8', borderRadius: 6, padding: '8px 12px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>عداد الوقت المنقضي</span>
                      <strong style={{ fontSize: '1.4rem', fontFamily: 'monospace' }}>{formatTimer(timerSeconds)}</strong>
                    </div>
                  </div>

                  <Textarea
                    label="ملاحظات المرحلة (اختياري)"
                    rows={2}
                    placeholder="أي ملاحظات حول مسار القطع، دقة الحروف، أو التوصيل..."
                    value={stageNotes}
                    onChange={(e) => setStageNotes(e.target.value)}
                  />

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    {!isTimerRunning ? (
                      <Button icon="play" disabled={submitting} onClick={() => handleStageAction('start')}>
                        بدء المرحلة
                      </Button>
                    ) : (
                      <Button variant="secondary" icon="pause" disabled={submitting} onClick={() => handleStageAction('pause')}>
                        إيقاف مؤقت
                      </Button>
                    )}
                    <Button variant="primary" icon="check" disabled={submitting} onClick={() => handleStageAction('complete')}>
                      إتمام المرحلة وحفظ الوقت
                    </Button>
                  </div>
                </div>

                {/* Materials Checklist */}
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>الخامات المنصرفة من المستودع</h4>
                  {selectedJob.materials?.length ? (
                    <ul style={{ margin: 0, paddingRight: 20, fontSize: '0.85rem' }}>
                      {selectedJob.materials.map((m) => (
                        <li key={m.id}>
                          <strong>{m.material_name}</strong> — {m.quantity} {m.unit} ({m.warehouse === 'main' ? 'مخزن رئيسي' : 'فضلة ورشة'})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>لم تُصرف خامات من المخزن حتى الآن.</p>
                  )}
                </div>

                {/* Quality Gate */}
                <div style={{ borderTop: '1px solid var(--madar-border, #e2e8f0)', paddingTop: 16 }}>
                  <Button
                    variant="secondary"
                    icon="shield"
                    disabled={submitting || selectedJob.status === 'ready'}
                    onClick={() => handleSubmitQA(selectedJob.id)}
                  >
                    إرسال الأمر لفحص الجودة النهائي
                  </Button>
                </div>
              </div>
            ) : (
              <div className="madar-panel" style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                <Icon name="wrench" size={32} />
                <p style={{ marginTop: 12 }}>اختر أمر تشغيل من القائمة للبدء في تسجيل المراحل وتحميل التصاميم.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Toast notice={notice} onClose={clearToast} />
    </div>
  );
}
