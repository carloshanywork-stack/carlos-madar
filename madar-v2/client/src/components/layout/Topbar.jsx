import { useLocation } from 'react-router-dom';
import Icon from '../ui/Icon.jsx';
import Button from '../ui/Button.jsx';
import StatusPills from './StatusPills.jsx';

const titles = {
  '/': ['لوحة المتابعة', 'صورة تشغيلية سريعة لأعمال النظام اليوم'],
  '/clients': ['العملاء', 'بيانات العملاء والعلاقات التشغيلية'],
  '/maintenance': ['الصيانة الميدانية', 'أوامر الصيانة وبطاقات فحص الآلات'],
  '/workshop': ['تشغيل الورشة', 'متابعة الإنتاج والتسليم والفواتير'],
  '/warehouse': ['المخزون والمواد', 'المخزن الرئيسي والقصاصات ومراجعة الرصيد'],
  '/finance': ['الخزينة والفواتير', 'الأرصدة والتحصيلات وفواتير المبيعات والمشتريات'],
  '/accounting': ['المحاسبة والموظفون', 'عرض بيانات التشغيل المالية المتاحة في V2'],
  '/staff': ['الفريق والكادر', 'ملفات الموظفين والمناديب وصلاحيات الدخول'],
  '/archive': ['الأرشيف والتقارير', 'الأعمال المؤرشفة وسجل الطلبات'],
  '/settings': ['إعدادات النظام', 'حالة خدمة MADAR V2 ومعلومات الإصدار'],
};

const roleLabels = {
  admin: 'المدير العام',
  sales: 'المبيعات',
  operations: 'العمليات',
  purchasing: 'المشتريات',
};

export default function Topbar({ onMenuClick, user, onLogout, theme, onThemeToggle }) {
  const { pathname } = useLocation();
  const route = pathname.replace(/\/\d+$/, '') || '/';
  const [title, context] = titles[route] ?? titles['/'];
  return (
    <header className="madar-topbar">
      <div className="madar-topbar-left">
        <Button className="madar-mobile-menu" icon="menu" iconOnly variant="secondary" aria-label="فتح القائمة" onClick={onMenuClick} />
        <div>
          <h1 className="madar-topbar-title">{title}</h1>
          <div className="madar-topbar-context">{context}</div>
        </div>
      </div>
      <div className="madar-topbar-right">
        <StatusPills />
        <div className="madar-user-account" title={user?.username}>
          <span className="madar-user-avatar" aria-hidden="true">
            {(user?.fullName || user?.username || '?').trim().slice(0, 1).toUpperCase()}
          </span>
          <span className="madar-user-copy">
            <strong>{user?.fullName || user?.username}</strong>
            <span className="madar-user-role">{roleLabels[user?.role] || user?.role}</span>
          </span>
        </div>
        <div className="madar-account-actions">
          <Button
            className="madar-theme-button"
            icon={theme === 'dark' ? 'sun' : 'moon'}
            iconOnly
            variant="secondary"
            aria-label={theme === 'dark' ? 'التبديل إلى المظهر الفاتح' : 'التبديل إلى المظهر الداكن'}
            title={theme === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن'}
            onClick={onThemeToggle}
          />
          <Button
            className="madar-logout-button"
            icon="logout"
            size="small"
            variant="secondary"
            onClick={onLogout}
          >
            خروج
          </Button>
        </div>
      </div>
    </header>
  );
}
