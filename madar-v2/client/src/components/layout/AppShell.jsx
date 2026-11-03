import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

export default function AppShell({ children, user, onLogout, theme, onThemeToggle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  return (
    <div className="madar-app-shell">
      <Sidebar open={menuOpen} onNavigate={closeMenu} user={user} />
      <div className="madar-workspace">
        <Topbar
          onMenuClick={() => setMenuOpen(true)}
          user={user}
          onLogout={onLogout}
          theme={theme}
          onThemeToggle={onThemeToggle}
        />
        <main className="madar-main">{children}</main>
        <footer className="madar-footer"><span>MADAR V2</span><span>نظام محلي لإدارة التشغيل والصيانة</span></footer>
      </div>
    </div>
  );
}
