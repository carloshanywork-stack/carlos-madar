import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';

function explorerUrl(path) {
  const query = new URLSearchParams();
  if (path) query.set('path', path);
  return `/api/maintenance/storage-explorer${query.size ? `?${query}` : ''}`;
}

export function TripScanProgress({ progress }) {
  const percent = Math.min(100, Math.max(0, Number(progress?.percent) || 0));
  return (
    <div className="madar-scan-progress-container" style={{ margin: '1.5rem 0', textAlign: 'center' }} aria-live="polite">
      <div
        role="progressbar"
        aria-label="تقدم فحص مجلد الرحلة"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ background: 'var(--madar-surface-alt)', borderRadius: '999px', height: '10px', overflow: 'hidden', border: '1px solid var(--madar-border)' }}
      >
        <div style={{ background: 'var(--madar-accent)', width: `${percent || 15}%`, height: '100%', transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '0.5rem', fontSize: '11px', color: 'var(--madar-muted)', textAlign: 'start' }}>
        <span>{progress?.stage || 'جارٍ فحص المجلد وربط الصور...'}{progress?.total > 0 ? ` (${progress.processed}/${progress.total})` : ''}</span>
        <strong>{percent}%</strong>
      </div>
    </div>
  );
}

export default function StorageFileExplorer({ initialPath = '', enabled = true, processing = false, progress, onProcessFolder }) {
  const [data, setData] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  const loadPath = useCallback(async (path, { fallbackToRoot = false } = {}) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      let result;
      try {
        result = await api.get(explorerUrl(path));
      } catch (caught) {
        if (!fallbackToRoot || !path || caught.status !== 404) throw caught;
        result = await api.get(explorerUrl(''));
      }
      if (requestId !== requestSequence.current) return;
      setData(result);
      setSelectedFolder(null);
      setSearch('');
    } catch (caught) {
      if (requestId === requestSequence.current) setError(errorMessage(caught));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void loadPath(initialPath, { fallbackToRoot: true });
    return () => { requestSequence.current += 1; };
  }, [enabled, initialPath, loadPath]);

  const visibleFolders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (data?.folders ?? []).filter((folder) => !term || folder.name.toLocaleLowerCase().includes(term));
  }, [data, search]);

  function openBreadcrumb(path) {
    if (path !== data?.currentPath) void loadPath(path);
  }

  return (
    <section className="madar-storage-explorer" aria-label="استكشاف مجلدات مناطق التخزين">
      <nav className="madar-storage-breadcrumbs" aria-label="مسار مجلد التخزين">
        {(data?.breadcrumbs ?? [{ name: 'Areas', path: '' }]).map((crumb, index) => (
          <Fragment key={`${crumb.path}-${crumb.name}`}>
            {index > 0 && <span className="madar-storage-breadcrumb-separator" aria-hidden="true">/</span>}
            <button
              type="button"
              className={`madar-storage-crumb ${crumb.path === data?.currentPath ? 'active' : ''}`}
              onClick={() => openBreadcrumb(crumb.path)}
              disabled={loading || crumb.path === data?.currentPath}
              aria-current={crumb.path === data?.currentPath ? 'page' : undefined}
            >
              {index === 0 ? 'الرئيسية (Areas)' : crumb.name}
            </button>
          </Fragment>
        ))}
      </nav>

      <div className="madar-storage-explorer-toolbar">
        <Input
          label="بحث سريع في هذا المستوى"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="اكتب اسم المجلد…"
          disabled={loading || Boolean(error)}
        />
        <span className="madar-storage-folder-count">{visibleFolders.length} مجلد</span>
      </div>

      <div className="madar-storage-folder-list" aria-live="polite">
        {loading ? <LoadingState label="جارٍ تحميل مجلدات التخزين" /> : error ? <Alert tone="error">{error}</Alert> : visibleFolders.length ? (
          <div className="madar-storage-folder-grid">
            {visibleFolders.map((folder) => {
              const selected = selectedFolder?.path === folder.path;
              return (
                <button
                  type="button"
                  key={folder.path}
                  className={`madar-storage-folder ${selected ? 'selected' : ''}`}
                  onClick={() => setSelectedFolder(folder)}
                  onDoubleClick={() => { void loadPath(folder.path); }}
                  aria-pressed={selected}
                  title="انقر مرتين لفتح المجلد"
                >
                  <span className="madar-storage-folder-icon"><Icon name="folder" size={22} /></span>
                  <span className="madar-storage-folder-copy">
                    <strong dir="auto">{folder.name}</strong>
                    <span className="madar-storage-folder-badges">
                      <span className="madar-storage-folder-badge"><Icon name="image" size={12} />{folder.photoCount} صورة</span>
                      <span className="madar-storage-folder-badge">{folder.hasSubfolders ? 'مجلدات فرعية' : 'بدون مجلدات فرعية'}</span>
                    </span>
                  </span>
                  {selected && <Badge tone="success"><Icon name="check" size={12} /> محدد</Badge>}
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="folder"
            title={search ? 'لا توجد مجلدات مطابقة' : 'لا توجد مجلدات فرعية هنا'}
            description={search ? 'جرّب كلمة بحث أخرى.' : 'ارجع إلى المجلد السابق أو اختر رفع ملف ZIP.'}
          />
        )}
      </div>

      {processing && <TripScanProgress progress={progress} />}
      <footer className="madar-storage-selection-footer">
        <div className="madar-storage-selected-copy" aria-live="polite">
          {selectedFolder ? <>
            <span>المجلد المحدد:</span>
            <strong dir="auto">{selectedFolder.name}</strong>
            <Badge tone="success"><Icon name="check" size={12} /> جاهز</Badge>
          </> : <span className="madar-muted">حدد مجلداً للمتابعة.</span>}
        </div>
        <Button
          icon="check"
          variant="primary"
          disabled={!selectedFolder || processing || loading || Boolean(error)}
          onClick={() => { if (selectedFolder) void onProcessFolder?.(selectedFolder); }}
        >
          {processing ? 'جارٍ الفحص…' : 'فحص وربط صور هذا المجلد'}
        </Button>
      </footer>
    </section>
  );
}
