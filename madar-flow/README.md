# Madar Flow

منصة أتمتة سير عمل مرئية (Node-based Workflow Automation) — عربية أولًا، self-hosted، ومصممة للاحتفاظ الدائم بكل البيانات.

> **الحالة:** Phase 5 — القوالب والتقوية والإطلاق (MVP)

---

## المتطلبات

| الأداة | الإصدار |
|---|---|
| Node.js | 22+ |
| pnpm | 12+ |
| Docker + Compose | حديث |

---

## التشغيل السريع

```bash
# 1. الإعدادات
cp .env.example .env
# عدّل JWT_ACCESS_SECRET وأضف CREDENTIALS_KEK (openssl rand -base64 32)

# 2. البنية التحتية
docker compose up -d postgres valkey

# 3. التثبيت والبناء
pnpm install
pnpm build

# 4. قاعدة البيانات
pnpm db:migrate

# 5. تشغيل API (نافذة)
pnpm --filter @madar/api dev

# 6. تشغيل worker (نافذة)
pnpm --filter @madar/worker dev

# 7. تشغيل scheduler (نافذة)
pnpm --filter @madar/scheduler dev

# 8. تشغيل الواجهة (نافذة)
pnpm --filter @madar/web dev
```

- API: <http://localhost:3001/api/v1/health>
- Web: <http://localhost:5173>
- دليل التشغيل الكامل: [`docs/phase-5.md`](docs/phase-5.md)

أو تشغيل كل شيء عبر Docker:

```bash
docker compose up --build
```

- Web: <http://localhost:8080>
- API: <http://localhost:3001>

---

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `pnpm build` | بناء كل الحزم |
| `pnpm typecheck` | فحص الأنواع |
| `pnpm test` | الاختبارات |
| `pnpm db:migrate` | تشغيل الـ Migrations |
| `pnpm db:status` | حالة الـ Migrations |
| `pnpm --filter @madar/api dev` | API مع إعادة التحميل |
| `pnpm --filter @madar/worker dev` | عامل التنفيذ |
| `pnpm --filter @madar/scheduler dev` | مجدول الـ Cron |
| `pnpm --filter @madar/web dev` | Vite Dev Server |
| `./scripts/backup-postgres.sh` | نسخ احتياطي يومي/شهري/سنوي (بلا حذف) |
| `./scripts/prune-docker.sh` | تقليم الصور المعلّقة وbuild cache فقط |

---

## الهيكل

```text
madar-flow/
├── apps/
│   ├── api/          # Fastify API
│   └── web/          # React + Vite
├── packages/
│   ├── shared/       # الأنواع، الأخطاء، UUIDv7، الصلاحيات
│   └── db/           # Drizzle Schema + Migrations
├── docs/
├── DECISIONS.md      # سجل القرارات الملزم
└── docker-compose.yml
```

---

## المبادئ غير القابلة للتفاوض

1. **لا حذف آلي لبيانات الأعمال** — Forever by Default.
2. **API لا ينفّذ Workflow** — يرسله للطابور ويعيد `202`.
3. **كل تنفيذ مربوط بنسخة غير قابلة للتعديل.**
4. **`workspace_id` في كل جدول أعمال.**
5. **الأسرار مشفرة ولا تظهر في الواجهة أو السجلات.**
6. **RTL أصلي، وليس ترجمة لاحقة.**

راجع [DECISIONS.md](./DECISIONS.md) للسجل الكامل.
