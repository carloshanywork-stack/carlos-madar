import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Toast from '../../components/ui/Toast.jsx';
import MachineCorrectionReview from './MachineCorrectionReview.jsx';
import MachineDirectoryMap from './MachineDirectoryMap.jsx';
import './machine-directory.css';

const PAGE_SIZE = 50;

export default function MachinesDirectory({ isAdmin = false, initialCorrections = false }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [area, setArea] = useState('');
  const [locationStatus, setLocationStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [directoryView, setDirectoryView] = useState(initialCorrections && isAdmin ? 'corrections' : 'machines');
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (debouncedSearch) query.set('search', debouncedSearch);
  if (area) query.set('area', area);
  if (locationStatus !== 'all') query.set('locationStatus', locationStatus);
  const { data, loading, error, reload } = useApi(`/api/maintenance/machines?${query.toString()}`);
  const mapQuery = new URLSearchParams();
  if (area) mapQuery.set('area', area);
  if (debouncedSearch) mapQuery.set('search', debouncedSearch);
  if (locationStatus !== 'all') mapQuery.set('locationStatus', locationStatus);
  const { data: mapData, reload: reloadMap } = useApi(`/api/maintenance/machines/map?${mapQuery.toString()}`, { enabled: isAdmin });
  const [modal, setModal] = useState('');
  const [editing, setEditing] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [geofenceMachine, setGeofenceMachine] = useState(null);
  const [geofenceDraft, setGeofenceDraft] = useState({ latitude: '', longitude: '', areaName: '' });
  const [geofenceError, setGeofenceError] = useState('');
  const [capturingLocation, setCapturingLocation] = useState(false);
  const { notice, showToast, clearToast } = useToast();
  const machines = data?.machines ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const areaOptions = useMemo(() => data?.areas ?? [], [data?.areas]);

  useEffect(() => {
    if (isAdmin && initialCorrections) setDirectoryView('corrections');
  }, [initialCorrections, isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function saveMachine(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const payload = { code: form.get('code'), name_ar: form.get('name_ar'), name_en: form.get('name_en') || null, area: form.get('area') };
    try {
      if (editing) await api.patch(`/api/maintenance/machines/${editing.id}`, payload);
      else await api.post('/api/maintenance/machines', payload);
      setModal('');
      setEditing(null);
      await Promise.all([reload(), reloadMap()]);
      showToast(editing ? 'تم تحديث بيانات الماكينة.' : 'تمت إضافة الماكينة.');
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function deactivate(machine) {
    if (/^TEST-ATM-[A-Z0-9-]+$/iu.test(machine.code)) {
      if (!window.confirm(`حذف ماكينة التدريب ${machine.code} نهائيًا؟\n\nسيُحذف كل أمر اختبار مرتبط بها، حتى المخفي سابقًا، مع الزيارات والصور والملفات. لن تُحذف بيانات أو حركات مالية غير اختبارية.`)) return;
      try {
        const result = await api.delete(`/api/maintenance/machines/${machine.id}/test-mock`);
        await Promise.all([reload(), reloadMap()]);
        showToast(result.cleanupPending ? 'حُذفت بيانات التدريب؛ تنظيف الملفات الممرحلة سيكتمل عند التشغيل التالي.' : 'حُذفت ماكينة التدريب وكل بياناتها المرتبطة نهائيًا.');
      } catch (caught) { showToast(errorMessage(caught), 'error'); }
      return;
    }
    if (!window.confirm(`هل تريد إيقاف الماكينة ${machine.code}؟ ستظل سجلاتها السابقة محفوظة.`)) return;
    try {
      await api.delete(`/api/maintenance/machines/${machine.id}`);
      await Promise.all([reload(), reloadMap()]);
      showToast('تم إيقاف الماكينة مع الاحتفاظ بسجلها.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  async function captureGeofenceLocation() {
    if (!navigator.geolocation) {
      setGeofenceError('هذا المتصفح لا يدعم تحديد الموقع. أدخل الإحداثيات يدوياً.');
      return;
    }
    setCapturingLocation(true);
    setGeofenceError('');
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      }));
      setGeofenceDraft((current) => ({
        ...current,
        latitude: String(position.coords.latitude),
        longitude: String(position.coords.longitude),
      }));
    } catch (caught) {
      setGeofenceError(caught.message || 'تعذر الحصول على GPS الحالي. أدخل الإحداثيات يدوياً أو اسمح بالموقع.');
    } finally {
      setCapturingLocation(false);
    }
  }

  async function saveGeofence(event) {
    event.preventDefault();
    if (!geofenceMachine) return;
    setSaving(true);
    setGeofenceError('');
    try {
      const latitude = Number(geofenceDraft.latitude);
      const longitude = Number(geofenceDraft.longitude);
      if (!geofenceDraft.latitude || !geofenceDraft.longitude || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('أدخل إحداثيات GPS صحيحة أو التقط الموقع الحالي.');
      }
      await api.patch(`/api/maintenance/machines/${geofenceMachine.id}/geofence`, {
        latitude,
        longitude,
        areaName: geofenceDraft.areaName,
      });
      setGeofenceMachine(null);
      await Promise.all([reload(), reloadMap()]);
      showToast(`ثُبّت موقع الماكينة ${geofenceMachine.code} ضمن نطاق 50 متراً.`);
    } catch (caught) {
      setGeofenceError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function previewImport(event) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setPreview(null);
    setFormError('');
    if (!file) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('file', file);
      setPreview(await api.upload('/api/maintenance/machines/import/preview', form));
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function importFile() {
    if (!selectedFile) return;
    setSaving(true);
    setUploadProgress(0);
    setFormError('');
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      const counts = await api.uploadWithProgress('/api/maintenance/machines/import', form, setUploadProgress);
      setModal('');
      setSelectedFile(null);
      setPreview(null);
      await Promise.all([reload(), reloadMap()]);
      showToast(`اكتمل الاستيراد: ${counts.added} جديد، ${counts.updated} محدّث، ${counts.skipped} متجاوز.`);
    } catch (caught) { setFormError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  return (
    <>
      {isAdmin && <div className="madar-machine-directory-tabs" role="tablist" aria-label="إدارة دليل الماكينات">
        <button type="button" role="tab" aria-selected={directoryView === 'machines'} className={directoryView === 'machines' ? 'active' : ''} onClick={() => setDirectoryView('machines')}>دليل الماكينات والخريطة</button>
        <button type="button" role="tab" aria-selected={directoryView === 'corrections'} className={directoryView === 'corrections' ? 'active' : ''} onClick={() => setDirectoryView('corrections')}>
          بلاغات التصحيح {mapData?.counts?.pending_correction > 0 && <b>{mapData.counts.pending_correction}</b>}
        </button>
      </div>}
      {directoryView === 'corrections' && isAdmin ? <MachineCorrectionReview onToast={showToast} /> : <>
      <div className="madar-list-toolbar madar-section">
        <label className="madar-field madar-search"><Icon name="search" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالكود أو الاسم أو المنطقة" aria-label="بحث في دليل الماكينات" /></label>
        <Select label="المنطقة" value={area} onChange={(event) => { setArea(event.target.value); setPage(1); }}>
          <option value="">كل المناطق</option>{areaOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
        <Select label="حالة الموقع" value={locationStatus} onChange={(event) => { setLocationStatus(event.target.value); setPage(1); }}>
          <option value="all">كل المواقع</option>
          <option value="located">موقع محدد</option>
          <option value="unlocated">غير محدد</option>
          {isAdmin && <option value="pending_correction">بلاغ تصحيح معلق</option>}
        </Select>
        <div className="madar-inline-wrap"><Button variant="secondary" icon="upload" onClick={() => { setModal('import'); setFormError(''); }}>استيراد Excel / CSV</Button><Button icon="plus" onClick={() => { setEditing(null); setFormError(''); setModal('machine'); }}>إضافة ماكينة جديدة</Button></div>
      </div>
      {error && <div className="madar-section"><Alert tone="error">{error}</Alert></div>}
      {isAdmin && <MachineDirectoryMap machines={mapData?.machines ?? []} counts={mapData?.counts} locationStatus={locationStatus} />}
      <section className="madar-panel madar-section">
        {loading ? <LoadingState label="جارٍ تحميل دليل الماكينات" /> : machines.length ? <>
          <div className="madar-table-wrap"><table className="madar-table">
            <thead><tr><th>كود الماكينة</th><th>الاسم بالعربي</th><th>الاسم بالإنجليزي</th><th>المنطقة</th><th>موقع GPS</th><th>عدد الأوامر</th><th>إجراءات</th></tr></thead>
            <tbody>{machines.map((machine) => <tr key={machine.id}>
              <td><span className="madar-code">{machine.code}</span>{isAdmin && machine.pending_correction_count > 0 && <span className="madar-machine-pending-badge">بلاغ تصحيح معلّق · {machine.pending_correction_count}</span>}</td><td><strong>{machine.name_ar}</strong></td><td>{machine.name_en || '—'}</td><td>{machine.area}</td>
              <td>{machine.is_location_locked && Number.isFinite(machine.latitude) && Number.isFinite(machine.longitude)
                ? <span title={`${machine.latitude}, ${machine.longitude}`}>مثبت · 50م</span>
                : <span style={{ color: 'var(--madar-warning, #9a6813)' }}>بحاجة إلى تثبيت</span>}</td>
              <td>{machine.order_count}</td>
              <td><div className="madar-inline-wrap">
                {isAdmin && <Button variant="ghost" size="small" onClick={() => {
                  setGeofenceMachine(machine);
                  setGeofenceDraft({
                    latitude: machine.latitude ?? '',
                    longitude: machine.longitude ?? '',
                    areaName: machine.area_name || machine.area || '',
                  });
                  setGeofenceError('');
                }}>إعداد الموقع</Button>}
                <Button variant="ghost" size="small" icon="settings" onClick={() => { setEditing(machine); setFormError(''); setModal('machine'); }}>تعديل</Button>
                {(!/^TEST-ATM-[A-Z0-9-]+$/iu.test(machine.code) || isAdmin) && <Button variant="ghost" size="small" icon="close" onClick={() => deactivate(machine)}>{/^TEST-ATM-[A-Z0-9-]+$/iu.test(machine.code) ? 'حذف اختبار نهائي' : 'إيقاف'}</Button>}
              </div></td>
            </tr>)}</tbody>
          </table></div>
          <div className="madar-table-footer"><span>إجمالي {data.total} ماكينة</span><div className="madar-inline-wrap"><Button variant="secondary" size="small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span>صفحة {page} من {pages}</span><Button variant="secondary" size="small" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div></div>
        </> : <EmptyState icon="factory" title="لا توجد ماكينات مطابقة" description="غيّر البحث أو المنطقة، أو أضف ماكينة جديدة." />}
      </section>

      <Modal open={modal === 'machine'} onClose={() => { setModal(''); setEditing(null); }} title={editing ? 'تعديل ماكينة' : 'إضافة ماكينة جديدة'}>
        <form onSubmit={saveMachine}>
          <div className="madar-form-stack">
            <Input label="كود الماكينة *" name="code" required defaultValue={editing?.code ?? ''} maxLength={64} />
            <Input label="الاسم بالعربي *" name="name_ar" required defaultValue={editing?.name_ar ?? ''} maxLength={200} />
            <Input label="الاسم بالإنجليزي" name="name_en" defaultValue={editing?.name_en ?? ''} maxLength={200} />
            <Input
              label="المنطقة *"
              name="area"
              required
              defaultValue={editing?.area ?? ''}
              maxLength={160}
              list="machine-areas-datalist"
              placeholder="اختر منطقة مسجلة أو اكتب اسم منطقة جديدة..."
              autoComplete="off"
            />
            <datalist id="machine-areas-datalist">
              {(areaOptions ?? []).map((areaName) => (
                <option key={areaName} value={areaName} />
              ))}
            </datalist>
          </div>
          {formError && <div className="madar-form-error"><Alert tone="error">{formError}</Alert></div>}
          <div className="madar-form-actions"><Button variant="secondary" onClick={() => setModal('')}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الماكينة'}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(geofenceMachine)} onClose={() => { if (!saving) setGeofenceMachine(null); }} title={`تثبيت موقع ${geofenceMachine?.code ?? 'الماكينة'}`} description="يجب تثبيت إحداثيات موثوقة قبل أن يتمكن المندوب من فتح الكاميرا. يقبل الخادم الزيارة داخل 50 متراً فقط.">
        <form onSubmit={saveGeofence}>
          <div className="madar-form-stack">
            <Input label="المحافظة / المنطقة المسجلة" value={geofenceDraft.areaName} onChange={(event) => setGeofenceDraft((current) => ({ ...current, areaName: event.target.value }))} maxLength={160} required />
            <Input label="خط العرض Latitude *" type="number" step="any" value={geofenceDraft.latitude} onChange={(event) => setGeofenceDraft((current) => ({ ...current, latitude: event.target.value }))} required />
            <Input label="خط الطول Longitude *" type="number" step="any" value={geofenceDraft.longitude} onChange={(event) => setGeofenceDraft((current) => ({ ...current, longitude: event.target.value }))} required />
            <p className="madar-muted">نطاق الزيارة ثابت عند 50 متراً. استخدم GPS وأنت بجوار الماكينة، أو أدخل إحداثياتها المسجلة.</p>
            {geofenceError && <Alert tone="error">{geofenceError}</Alert>}
          </div>
          <div className="madar-form-actions">
            <Button variant="secondary" type="button" onClick={() => void captureGeofenceLocation()} disabled={capturingLocation || saving}>{capturingLocation ? 'جارٍ تحديد الموقع…' : 'التقاط GPS الحالي'}</Button>
            <Button variant="secondary" type="button" onClick={() => setGeofenceMachine(null)} disabled={saving}>إلغاء</Button>
            <Button type="submit" disabled={saving || capturingLocation}>{saving ? 'جارٍ الحفظ…' : 'تثبيت الموقع'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'import'} onClose={() => { if (!saving) { setModal(''); setSelectedFile(null); setPreview(null); } }} title="استيراد دليل الماكينات" description="يدعم Excel وCSV. تتم المطابقة على كود الماكينة للحفاظ على المعرفات والارتباطات الحالية.">
        <div className="madar-form-stack">
          <Input label="ملف Excel أو CSV" type="file" accept=".xlsx,.xls,.csv" onChange={previewImport} />
          {preview && <>
            <Alert tone="info">عدد الصفوف: {preview.totalRows} · صفوف مكتملة ضمن المعاينة: {preview.previewValidRows}</Alert>
            {preview.preview.length > 0 && <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الكود</th><th>الاسم العربي</th><th>الاسم الإنجليزي</th><th>المنطقة</th></tr></thead><tbody>{preview.preview.map((row, index) => <tr key={`${row.code}-${index}`}><td>{row.code || '—'}</td><td>{row.name_ar || '—'}</td><td>{row.name_en || '—'}</td><td>{row.area || '—'}</td></tr>)}</tbody></table></div>}
          </>}
          {saving && selectedFile && <div className="madar-small madar-muted">جارٍ {preview ? 'الاستيراد' : 'قراءة المعاينة'}… {uploadProgress ? `${uploadProgress}%` : ''}</div>}
          {uploadProgress > 0 && <progress value={uploadProgress} max="100" aria-label="تقدم رفع الملف" />}
          {formError && <Alert tone="error">{formError}</Alert>}
        </div>
        <div className="madar-form-actions"><Button variant="secondary" disabled={saving} onClick={() => setModal('')}>إلغاء</Button><Button disabled={!selectedFile || !preview || saving} onClick={importFile} icon="upload">{saving ? 'جارٍ الاستيراد…' : 'تنفيذ الاستيراد'}</Button></div>
      </Modal>
      </>}
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
