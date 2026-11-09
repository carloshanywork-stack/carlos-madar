# Phase 0 — الأساسيات

**المدة:** أسبوعان  
**الهدف:** نظام يعمل من أول أمر، مع مصادقة وقاعدة بيانات ومراقبة.

---

## المخرجات

| المخرج | الحالة |
|---|---|
| Monorepo (pnpm + Turborepo + TypeScript) | ✅ |
| CI (Lint + Typecheck + Test + Build) | ✅ |
| Docker Compose (Postgres + Valkey + MinIO + API + Web) | ✅ |
| تحقق من متغيرات البيئة | ✅ |
| Schema أولي + Migrations | ✅ |
| Auth Skeleton (Register / Login / Refresh / Logout / Me) | ✅ |
| Observability (Pino + Health + Ready) | ✅ |
| API Skeleton + Error Contract (RFC 9457) | ✅ |

---

## معيار الخروج

```text
□ docker compose up -d postgres valkey  → الخدمات Healthy
□ pnpm install && pnpm build            → نجاح
□ pnpm db:migrate                       → تطبيق كل الـ Migrations
□ GET /api/v1/health                    → 200
□ GET /api/v1/ready                     → 200 مع فحص DB + Valkey + Migrations
□ Register → Login → Refresh → Me       → يعمل
□ إنشاء Workspace وعرضه                 → يعمل
□ pnpm test                             → أخضر
```

---

## ملاحظات

- **لا أسرار في المستودع.** `.env` مستثنى.
- **لا Migrations من داخل API.** تُشغَّل كخطوة منفصلة.
- **لا `docker compose down -v`** على بيانات حقيقية.
- **لا `drizzle-kit push`** — الـ Migrations هي المصدر.
