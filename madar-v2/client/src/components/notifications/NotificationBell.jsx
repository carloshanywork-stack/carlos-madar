import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import Icon from '../ui/Icon.jsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'madar-notifications';
const MAX_BADGE = 99;

function cacheKey(userId) {
  return `${CACHE_PREFIX}:${Number(userId)}`;
}

function normalizeNotification(item) {
  const id = Number(item?.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const message = typeof item?.message === 'string' ? item.message.trim() : '';
  if (!message) return null;
  const occurredAt = typeof item?.occurredAt === 'string' ? item.occurredAt : '';
  const href = typeof item?.href === 'string' && item.href.startsWith('/') && !item.href.startsWith('//')
    ? item.href
    : null;
  return {
    id,
    eventId: Number.isSafeInteger(Number(item?.eventId)) ? Number(item.eventId) : null,
    type: typeof item?.type === 'string' ? item.type : '',
    message,
    href,
    occurredAt,
    read: Boolean(item?.read),
    readAt: typeof item?.readAt === 'string' ? item.readAt : null,
  };
}

function sortNewestFirst(items) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    return right.id - left.id;
  });
}

function readCachedInbox(userId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(userId)) ?? 'null');
    if (!parsed || !Array.isArray(parsed.notifications)) return null;
    const notifications = sortNewestFirst(parsed.notifications.map(normalizeNotification).filter(Boolean));
    const unreadCount = Number.isSafeInteger(Number(parsed.unreadCount))
      ? Math.max(0, Number(parsed.unreadCount))
      : notifications.filter((item) => !item.read).length;
    return { notifications, unreadCount };
  } catch {
    return null;
  }
}

function writeCachedInbox(userId, notifications, unreadCount) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) return;
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify({
      notifications,
      unreadCount,
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // The server inbox remains authoritative when browser storage is unavailable.
  }
}

function formatNotificationTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'وقت غير معروف';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  }).format(new Date(time));
}

function isRecent(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time < DAY_MS;
}

function triggerLabel(unreadCount) {
  if (unreadCount > 0) return `الإشعارات، ${unreadCount} غير مقروءة`;
  return 'الإشعارات';
}

export default function NotificationBell({ user, online = true, variant = 'web' }) {
  const userId = Number(user?.id);
  const panelId = useId();
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const hydratedUserRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const connected = Boolean(online) && (typeof navigator === 'undefined' || navigator.onLine !== false);
  const wasConnectedRef = useRef(connected);

  const applyInbox = useCallback((payload) => {
    if (!payload || !Array.isArray(payload.notifications)) return;
    const next = sortNewestFirst(payload.notifications.map(normalizeNotification).filter(Boolean));
    const count = Number.isSafeInteger(Number(payload.unreadCount))
      ? Math.max(0, Number(payload.unreadCount))
      : next.filter((item) => !item.read).length;
    setNotifications(next);
    setUnreadCount(count);
  }, []);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!Number.isSafeInteger(userId) || userId < 1 || !connected) return;
    if (!quiet) setLoading(true);
    try {
      const payload = await api.get('/api/notifications', { timeoutMs: 10_000 });
      applyInbox(payload);
      setError('');
    } catch (caught) {
      setError(caught.message || 'تعذر تحميل الإشعارات.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [applyInbox, connected, userId]);

  useEffect(() => {
    // Hydrate from this user's cache exactly once. Writing the cache in the same
    // pass as a user switch would persist the previous account's inbox under the
    // new account's key, so the write is skipped until the inbox matches.
    if (hydratedUserRef.current !== userId) {
      hydratedUserRef.current = userId;
      const cached = readCachedInbox(userId);
      setNotifications(cached?.notifications ?? []);
      setUnreadCount(cached?.unreadCount ?? 0);
      setOpen(false);
      setError('');
      setBusy('');
      if (connected) void load({ quiet: true });
      return;
    }
    writeCachedInbox(userId, notifications, unreadCount);
  }, [connected, load, notifications, unreadCount, userId]);

  useEffect(() => {
    if (connected && !wasConnectedRef.current) void load({ quiet: true });
    wasConnectedRef.current = connected;
  }, [connected, load]);

  useEffect(() => {
    const refresh = () => { void load({ quiet: true }); };
    const onOnline = () => { void load({ quiet: true }); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load({ quiet: true });
    };
    window.addEventListener('madar:notifications-changed', refresh);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = connected ? window.setInterval(refresh, 60_000) : null;
    return () => {
      window.removeEventListener('madar:notifications-changed', refresh);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) window.clearInterval(timer);
    };
  }, [connected, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function togglePanel() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void load();
  }

  async function markRead(notification) {
    if (!connected || notification.read || busy) return;
    const previous = notifications;
    const previousUnread = unreadCount;
    setBusy(`read-${notification.id}`);
    setNotifications((current) => current.map((item) => item.id === notification.id
      ? { ...item, read: true, readAt: new Date().toISOString() }
      : item));
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      const payload = await api.post(`/api/notifications/${notification.id}/read`);
      if (Number.isSafeInteger(Number(payload?.unreadCount))) {
        setUnreadCount(Math.max(0, Number(payload.unreadCount)));
      }
      setError('');
    } catch (caught) {
      setNotifications(previous);
      setUnreadCount(previousUnread);
      setError(caught.message || 'تعذر تحديد الإشعار كمقروء.');
    } finally {
      setBusy('');
    }
  }

  async function markAllRead() {
    if (!connected || unreadCount === 0 || busy) return;
    const previous = notifications;
    const previousUnread = unreadCount;
    setBusy('all');
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, read: true, readAt: item.readAt ?? readAt })));
    setUnreadCount(0);
    try {
      const payload = await api.post('/api/notifications/read-all');
      if (Number.isSafeInteger(Number(payload?.unreadCount))) {
        setUnreadCount(Math.max(0, Number(payload.unreadCount)));
      }
      setError('');
    } catch (caught) {
      setNotifications(previous);
      setUnreadCount(previousUnread);
      setError(caught.message || 'تعذر تحديد الإشعارات كمقروءة.');
    } finally {
      setBusy('');
    }
  }

  async function dismiss(notification) {
    if (!connected || busy) return;
    const previous = notifications;
    const previousUnread = unreadCount;
    setBusy(`dismiss-${notification.id}`);
    setNotifications((current) => current.filter((item) => item.id !== notification.id));
    if (!notification.read) setUnreadCount((current) => Math.max(0, current - 1));
    try {
      const payload = await api.delete(`/api/notifications/${notification.id}`);
      if (Number.isSafeInteger(Number(payload?.unreadCount))) {
        setUnreadCount(Math.max(0, Number(payload.unreadCount)));
      }
      setError('');
    } catch (caught) {
      setNotifications(previous);
      setUnreadCount(previousUnread);
      setError(caught.message || 'تعذر إغلاق الإشعار.');
    } finally {
      setBusy('');
    }
  }

  function notificationBody(notification) {
    const content = (
      <>
        <span className="madar-notification-message">{notification.message}</span>
        <span className="madar-notification-meta">
          <time dateTime={notification.occurredAt}>{formatNotificationTime(notification.occurredAt)}</time>
          <span className={`madar-notification-state ${notification.read ? 'read' : 'unread'}`}>
            {notification.read ? 'مقروء' : 'غير مقروء'}
          </span>
          {!notification.read && isRecent(notification.occurredAt) && <span className="madar-notification-new">جديد</span>}
        </span>
      </>
    );
    if (variant === 'rep' || !notification.href) {
      return (
        <button
          type="button"
          className="madar-notification-body"
          onClick={() => void markRead(notification)}
          disabled={!connected || busy === `read-${notification.id}`}
          aria-label={`${notification.message}${notification.read ? '' : ' · تحديد كمقروء'}`}
        >
          {content}
        </button>
      );
    }
    return (
      <a
        className="madar-notification-body"
        href={notification.href}
        onClick={() => { void markRead(notification); }}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={`madar-notification-bell ${variant === 'rep' ? 'madar-notification-bell-rep' : ''} ${open ? 'open' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="madar-notification-trigger"
        aria-label={triggerLabel(unreadCount)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={togglePanel}
      >
        <Icon name="bell" size={18} />
        {unreadCount > 0 && (
          <span className="madar-notification-badge" aria-hidden="true">
            {unreadCount > MAX_BADGE ? `${MAX_BADGE}+` : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <section id={panelId} className="madar-notification-panel" role="dialog" aria-label="الإشعارات">
          <header className="madar-notification-panel-head">
            <div>
              <strong>الإشعارات</strong>
              <small>{unreadCount > 0 ? `${unreadCount} غير مقروءة` : 'كل الإشعارات مقروءة'}</small>
            </div>
            <div className="madar-notification-panel-actions">
              <button
                type="button"
                className="madar-notification-mark-all"
                onClick={() => void markAllRead()}
                disabled={!connected || unreadCount === 0 || busy === 'all'}
              >
                {busy === 'all' ? 'جارٍ التحديد…' : 'تحديد الكل كمقروء'}
              </button>
              <button
                type="button"
                className="madar-notification-close"
                aria-label="إغلاق لوحة الإشعارات"
                onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </header>
          {!connected && <p className="madar-notification-note">أنت غير متصل؛ تُعرض آخر إشعارات محفوظة على هذا الجهاز حتى عودة الاتصال.</p>}
          {error && <p className="madar-notification-error" role="alert">{error}</p>}
          {loading && notifications.length === 0 ? (
            <p className="madar-notification-empty" role="status">جارٍ تحميل الإشعارات…</p>
          ) : notifications.length === 0 ? (
            <p className="madar-notification-empty" role="status">لا توجد إشعارات حالياً.</p>
          ) : (
            <ul className="madar-notification-list">
              {notifications.map((notification) => (
                <li key={notification.id} className={`madar-notification-item ${notification.read ? 'read' : 'unread'}`}>
                  <span className="madar-notification-dot" aria-hidden="true" />
                  {notificationBody(notification)}
                  <div className="madar-notification-item-actions">
                    {!notification.read && (
                      <button
                        type="button"
                        className="madar-notification-item-action read-action"
                        aria-label={`تحديد الإشعار كمقروء: ${notification.message}`}
                        title="تحديد كمقروء"
                        disabled={!connected || busy === `read-${notification.id}`}
                        onClick={() => void markRead(notification)}
                      >
                        <Icon name="check" size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="madar-notification-item-action"
                      aria-label={`إغلاق الإشعار: ${notification.message}`}
                      title="إغلاق الإشعار"
                      disabled={!connected || busy === `dismiss-${notification.id}`}
                      onClick={() => void dismiss(notification)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <footer className="madar-notification-panel-foot">
            <span>{notifications.length ? `${notifications.length} إشعار` : 'لا إشعارات'}</span>
            <button type="button" onClick={() => void load()} disabled={!connected || loading}>
              {loading ? 'جارٍ التحديث…' : 'تحديث'}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
