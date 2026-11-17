# MADAR Design System & Figma MCP Integration Rules

This document serves as the authoritative guide for integrating Figma designs, components, and design tokens into the **MADAR V2** codebase using the Model Context Protocol (MCP).

---

## 1. Token Definitions

### Location & Structure
All design tokens are defined as CSS Custom Properties in:
- [madar-v2/client/src/styles/tokens.css](file:///home/carlos/Desktop/MADAR/madar-v2/client/src/styles/tokens.css)

Tokens are strictly scoped to `#madar-app` (light mode) and `#madar-app[data-theme="dark"]` (dark mode).

### Color Tokens
```css
/* Core Brand & Surfaces (Light) */
--madar-ink: #15243a;
--madar-ink-soft: #213550;
--madar-canvas: #f2f5f8;
--madar-surface: #ffffff;
--madar-surface-alt: #f5f7fa;
--madar-border: #e4e9ef;
--madar-text: #17263c;
--madar-muted: #748197;

/* Brand Accents */
--madar-accent: #187b68;          /* Emerald/Teal primary */
--madar-accent-strong: #116754;   /* Hover/Active state */
--madar-accent-pale: #e7f4ef;     /* Badge & selected background */
--madar-gold: #dcaa52;            /* Secondary brand highlight */

/* Semantic Feedback */
--madar-success: #27866d;
--madar-warning: #ae741d;
--madar-danger: #bd4e51;
--madar-selected: #e8f2ff;

/* Elevation & Layout */
--madar-shadow: 0 16px 42px rgba(24, 43, 69, 0.08);
--madar-page-gutter: clamp(14px, 2.5vw, 42px);
```

### Dark Mode Overrides
When `data-theme="dark"` is active on `#madar-app`:
```css
#madar-app[data-theme="dark"] {
  --madar-canvas: #0b0f17;
  --madar-surface: #131b27;
  --madar-surface-alt: #1a2434;
  --madar-border: #233044;
  --madar-text: #f1f5f9;
  --madar-muted: #94a3b8;
  --madar-accent: #2dd4bf;
  --madar-accent-strong: #14b8a6;
  --madar-accent-pale: rgba(45, 212, 191, 0.12);
  --madar-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.5);
}
```

### Safe Area Metrics (Mobile/Capacitor)
```css
--madar-safe-top: env(safe-area-inset-top, 0px);
--madar-safe-right: env(safe-area-inset-right, 0px);
--madar-safe-bottom: env(safe-area-inset-bottom, 0px);
--madar-safe-left: env(safe-area-inset-left, 0px);
```

---

## 2. Component Library

### Location & Architecture
Reusable atomic UI components live in:
- [madar-v2/client/src/components/ui/](file:///home/carlos/Desktop/MADAR/madar-v2/client/src/components/ui/)

Components follow a functional React pattern with prop-driven variants and zero CSS-in-JS runtime overhead.

### Key Components

#### Button (`Button.jsx`)
```jsx
import Button from '../../components/ui/Button.jsx';

<Button variant="primary" icon="plus" onClick={handleCreate}>
  إضافة ماكينة جديدة
</Button>
<Button variant="secondary" icon="upload" onClick={handleUpload}>
  رفع ملف
</Button>
<Button variant="ghost" icon="trash" iconOnly aria-label="حذف" onClick={handleDelete} />
```
- **Variants**: `'primary'` (default), `'secondary'`, `'ghost'`, `'danger'`
- **Sizes**: `'small'`, normal
- **Props**: `icon`, `iconOnly`, `disabled`, `type`, `loading`

#### Form Fields (`Field.jsx`)
```jsx
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';

<Input label="اسم العميل *" name="name" required placeholder="أدخل اسم العميل" />
<Select label="حالة الماكينة" name="condition" defaultValue="working">
  <option value="working">تعمل</option>
  <option value="faulty">عطلانة</option>
</Select>
<Textarea label="ملاحظات" name="notes" rows={3} maxLength={1000} />
```

#### Modal Dialog (`Modal.jsx`)
```jsx
import Modal from '../../components/ui/Modal.jsx';

<Modal
  open={isOpen}
  onClose={() => setIsOpen(false)}
  title="تأكيد العملية"
  description="سيتم إرسال الطلب للاعتماد مباشرة"
>
  <form onSubmit={handleSubmit}>
    {/* Body content */}
    <div className="madar-form-actions">
      <Button variant="secondary" onClick={() => setIsOpen(false)}>إلغاء</Button>
      <Button type="submit">تأكيد</Button>
    </div>
  </form>
</Modal>
```

#### Feedback: Badge, Alert, Toast
- `Badge.jsx`: `<Badge tone="success">معتمد</Badge>` (tones: `success`, `warning`, `danger`, `info`)
- `Alert.jsx`: `<Alert tone="error">حدث خطأ في الاتصال</Alert>`
- `Toast.jsx`: Managed via `const { showToast } = useToast();`

---

## 3. Frameworks & Libraries

- **Core**: React 18 (`react`, `react-dom`, `react-router-dom` v6).
- **Build System**: Vite 5 (`vite.config.js` in `madar-v2/client`). Output in `client/dist`.
- **CSS Solution**: Semantic CSS variables + scoped class selectors under `#madar-app`.
- **Virtualization**: TanStack Virtual (`@tanstack/react-virtual`) for infinite/virtual photo grids.
- **Mobile Container**: Capacitor 6 (`@capacitor/core`, `@capacitor/android`) with native Android Java bridge plugins for GPS, biometrics, offline camera, and WorkManager sync.
- **Desktop Container**: Electron 33 (`madar-v2/desktop-app/main.cjs`) targeting Windows NSIS installers.

---

## 4. Asset Management

- **Storage Architecture**: Persistent files are stored in the root `storage/` directory (never inside `client/` or `system/`).
- **Image Pipeline**: Original field photos are preserved byte-for-byte. Derived thumbnails are generated dynamically via Sharp as 200px WebP images:
  - Route: `GET /api/files/thumbnail?path=...`
- **Report Media**: PPTX and Word exports re-compress source images in-memory to JPEG (max 800px, 75 quality) without mutating originals.
- **Static Assets**: SVG brand marks live in `madar-v2/client/public/icon.svg`.

---

## 5. Icon System

### Location & Implementation
The icon system is lightweight, self-contained, and defined in:
- [madar-v2/client/src/components/ui/Icon.jsx](file:///home/carlos/Desktop/MADAR/madar-v2/client/src/components/ui/Icon.jsx)

It embeds SVG paths directly without external font libraries or bundle bloat:
```jsx
import Icon from '../../components/ui/Icon.jsx';

<Icon name="wrench" size={18} className="my-custom-class" />
```

### Icon Specifications
- **ViewBox**: `0 0 24 24`
- **Stroke**: `1.8px`
- **LineCap / LineJoin**: `round`
- **Fill**: `none` (stroke-based icons)
- **Names Available**: `grid`, `users`, `wrench`, `factory`, `boxes`, `wallet`, `chart`, `archive`, `settings`, `plus`, `search`, `close`, `trash`, `menu`, `chevron`, `arrow`, `calendar`, `clock`, `file`, `folder`, `map`, `upload`, `download`, `image`, `check`, `alert`, `refresh`, `history`, `bell`, `moon`, `sun`, `logout`.

---

## 6. Styling Approach

### Direction & Localization
- **RTL-First**: Entire UI defaults to `dir="rtl"` with Arabic typography (`"Segoe UI", Tahoma, Arial, sans-serif`).
- **CSS Hierarchy**:
  1. `tokens.css` (CSS Custom properties)
  2. `base.css` (Reset, app shell, navigation, tables, grid layouts)
  3. `auth.css` (Login, setup, splash)
  4. Module-specific CSS files (e.g., `rep.css`, `supervisor-radar.css`, `machine-directory.css`).
- **Responsive Layout**:
  - Desktop-first responsive grids with breakpoints at `1024px`, `768px`, and `480px`.
  - Fluid margins via `clamp(14px, 2.5vw, 42px)`.

---

## 7. Project Structure & Organization Patterns

```
madar-v2/
├── client/                     # Web / Mobile SPA (Vite + React)
│   ├── src/
│   │   ├── components/         # Reusable layouts & UI primitives
│   │   │   ├── layout/         # AppShell, Sidebar, TopBar
│   │   │   └── ui/             # Button, Field, Modal, Badge, Icon, Toast...
│   │   ├── modules/            # Feature domains
│   │   │   ├── rep/            # Field Representative mobile flow & offline store
│   │   │   ├── supervisor/     # Radar tracking, QA review, visit approvals
│   │   │   ├── maintenance/    # Machines directory, service orders, PPTX export
│   │   │   ├── warehouse/      # Inventory, offcuts, stock counting
│   │   │   ├── workshop/       # Orders, technicians, cutting orders
│   │   │   ├── finance/        # Treasury entries, invoices, payments
│   │   │   ├── accounting/     # Attendance matrix, payroll, staff
│   │   │   ├── clients/        # Client directory & financial balances
│   │   │   └── settings/       # System configuration, audit logs, releases
│   │   ├── lib/                # Shared helpers (api.js, format.js, useApi.js)
│   │   └── styles/             # tokens.css, base.css
│   └── vite.config.js
├── server/                     # Backend API (Express + better-sqlite3)
│   ├── modules/                # Feature-aligned backend routes & services
│   ├── database/               # SQLite schema, migrations (WAL mode)
│   └── config/                 # Paths, environment configuration
├── android/                    # Android Project (Capacitor + Native Java plugins)
│   └── app/src/main/java/com/madar/rep/app/
└── desktop-app/                # Windows Desktop Shell (Electron)
```

---

## 8. Principles for Translating Figma Designs into MADAR Code

1. **Always Use Existing Tokens**: Never hardcode hex values like `#187b68`; use `var(--madar-accent)`.
2. **Reuse Atomic UI Components**: Always map Figma buttons, modals, badges, and text inputs to `<Button>`, `<Modal>`, `<Badge>`, and `<Field>` from `components/ui/`.
3. **Strict Domain Rules**:
   - **Financial Transactions**: All financial modifications (treasury, invoices, payments, purchase orders) **require a direct server connection**; do NOT introduce optimistic offline queues for finance.
   - **Field Rep Work**: Must remain resilient in offline mode, storing visits, images, and attendance in IndexedDB/Room until connectivity is restored.
