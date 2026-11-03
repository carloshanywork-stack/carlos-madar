import { NavLink, useLocation } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';

const sections = [
  { path: '/', label: 'لوحة المتابعة', icon: 'grid', end: true },
  { path: '/clients', label: 'العملاء', icon: 'users' },
  { path: '/maintenance', label: 'الصيانة الميدانية', icon: 'wrench' },
  { path: '/workshop', label: 'تشغيل الورشة', icon: 'factory' },
  { path: '/warehouse', label: 'المخزون والمواد', icon: 'boxes' },
  { path: '/finance', label: 'الخزينة والفواتير', icon: 'wallet' },
  { path: '/accounting', label: 'المحاسبة والموظفون', icon: 'chart' },
  { path: '/archive', label: 'الأرشيف والتقارير', icon: 'archive' },
  { path: '/settings', label: 'إعدادات النظام', icon: 'settings' },
];

export default function Sidebar({ open, onNavigate, user }) {
  const location = useLocation();
  return (
    <>
      <div className={`madar-mobile-scrim ${open ? 'visible' : ''}`} onClick={onNavigate} aria-hidden="true" />
      <aside className={`madar-sidebar ${open ? 'open' : ''}`}>
        <div className="madar-brand">
          <span className="madar-brand-mark">M</span>
          <span className="madar-brand-copy">
            <span className="madar-brand-name">MADAR</span>
            <span className="madar-brand-subtitle">نظام إدارة التشغيل والصيانة</span>
          </span>
        </div>
        <div className="madar-sidebar-caption">مساحات العمل</div>
        <nav className="madar-nav" aria-label="التنقل الرئيسي">
          {[...sections.slice(0, 3), ...(user?.role === 'admin' ? [{ path: '/supervisor', label: 'رادار المشرف', icon: 'map' }] : []), ...sections.slice(3)].map((item) => {
            const nested = item.path !== '/' && location.pathname.startsWith(`${item.path}/`);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) => `madar-nav-link ${isActive || nested ? 'active' : ''}`}
              >
                <Icon name={item.icon} size={17} />
                <span className="madar-nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="madar-sidebar-bottom">
          <div className="madar-release-card">
            <div className="madar-release-title"><span className="madar-release-dot" /> النظام يعمل</div>
            <span className="madar-release-version">MADAR v2.0.0-release</span>
          </div>
          <div className="madar-sidebar-footnote">منظومة محلية لإدارة العمليات</div>
        </div>
      </aside>
    </>
  );
}
