# Phase 5 — القوالب، التقوية، والإطلاق

> الحالة: مكتمل. هذه الوثيقة هي دليل التشغيل (Runbook) لإطلاق MVP وتشغيله على خادم واحد.

---

## 1. ما الذي أُنجز في Phase 5؟

| البند | النتيجة |
|---|---|
| قوالب WF1–WF5 | `packages/shared/src/templates.ts` — خمسة قوالب مطابقة لجدول القبول في `DECISIONS.md` |
| API للقوالب | `GET /api/v1/workspaces/:id/workflow-templates` و `POST .../workflow-templates/:templateId/instantiate` |
| واجهة القوالب | معرض «ابدأ من قالب جاهز» في صفحة الـ Workflows |
| اختبارات E2E | `packages/engine/test/templates.test.ts` ينفّذ القوالب الخمسة فعليًا ضد HTTP server محلي |
| اختبارات API | `apps/api/test/templates.test.ts` — التعداد، الإنشاء كمسودة، تعيين الاعتماد، رفض المراجع الأجنبية |
| Rate limiting | عام 600/دقيقة لكل IP، مصادقة 15/دقيقة، Webhooks 120/دقيقة |
| Security headers | Helmet للـ API + رؤوس Nginx وCSP للواجهة + تعطيل Buffering لمسار SSE |
| CI | `TEST_DATABASE_URL` مضاف، والـ Migrations تعمل قبل الاختبارات |
| Docker | إزالة MinIO غير المستخدم؛ سكربت تقليم الصور والـ build cache فقط |
| التوثيق | هذه الوثيقة + تحديث README |

### إصلاحات مصاحبة

- **التحقق من اعتماد Webhook قبل النشر**: كان الشرط يُتجاوز إذا لم يكن في الرسم أي `credentialId`. أصبح كل Webhook مفعّل يتطلب اعتماد HMAC حتى لو كانت بقية العقد بلا اعتمادات.
- **إعادة المحاولة المزدوجة**: كانت `http` تعيد المحاولة داخليًا بينما الـ executor يعيدها أيضًا (3×3 = 9 محاولات). أصبحت إعادة المحاولة مملوكة للـ executor فقط، مع احترام `retryable` (لا إعادة محاولة لأخطاء 4xx غير 408/429).

---

## 2. القوالب الخمسة

يُنشئ الاستخدام **مسودة** (`revision = 1`) ولا ينشر شيئًا. استبدل الروابط التجريبية `https://example.com/...` قبل النشر.

| # | المعرّف | الاسم | Trigger | العقد | ملاحظات |
|---|---|---|---|---|---|
| WF1 | `wf1-health-check` | فحص صحة النظام | Manual | `manual → set → http → noop` | 3 محاولات، مهلة 10s |
| WF2 | `wf2-webhook-alert` | تنبيه Webhook | Webhook | `webhook → set → if → http / noop + error` | **يتطلب اعتماد HMAC** قبل النشر |
| WF3 | `wf3-daily-report` | تقرير يومي | Schedule | `schedule → http → if → noop ×2` | `0 9 * * *` بتوقيت `Africa/Cairo` |
| WF4 | `wf4-two-source-sync` | مزامنة مصدرين | Manual | `manual → set → http ×2 → merge → set → http` | Fan-out / Fan-in |
| WF5 | `wf5-api-monitor` | مراقبة API | Schedule | `schedule → http → if → set ×2 + error → noop` | `*/15 * * * *`، مسار خطأ بعد 3 محاولات |

### إنشاء Workflow من قالب عبر API

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  "http://localhost:3001/api/v1/workspaces/$WORKSPACE_ID/workflow-templates/wf2-webhook-alert/instantiate" \
  -d '{
    "name": "تنبيهات الإنتاج",
    "urls": { "wf2_send": "https://alerts.internal.example/hook" },
    "credentialIds": { "wf2_webhook": "00000000-0000-7000-8000-000000000000" }
  }'
```

- `urls` و `credentialIds` مفاتيحها **معرّفات عقد القالب** (مثل `wf4_source_a`).
- أي مفتاح لعقدة غير موجودة → `400 validation_error`.
- اعتماد من مساحة عمل أخرى أو ملغى → `400`.
- النشر يتحقق من وجود HMAC صالح لعقد Webhook ومن عدم تكرار المسار داخل نفس المساحة.

---

## 3. الإعدادات والأسرار

### متغيرات البيئة الإلزامية للإنتاج

| المتغير | الوصف |
|---|---|
| `DATABASE_URL` | PostgreSQL 16+ |
| `VALKEY_URL` | Valkey/Redis للـ BullMQ وSSE |
| `JWT_ACCESS_SECRET` | 32 حرفًا على الأقل — `openssl rand -base64 48` |
| `CREDENTIALS_KEK` | **إلزامي في الإنتاج** — مفتاح AES-256-GCM بصيغة base64 لـ 32 بايت: `openssl rand -base64 32` |
| `COOKIE_SECURE` | `true` خلف HTTPS |
| `CORS_ORIGIN` | أصل الواجهة فقط |
| `TRUST_PROXY` | `true` خلف Reverse Proxy موثوق |

> **تحذير:** تغيير `CREDENTIALS_KEK` دون إعادة تغليف (re-wrap) مفاتيح الاعتمادات يجعل الاعتمادات القديمة غير قابلة للفك. لا تُغيّره أثناء التشغيل. مفتاح التطوير المشتق من `JWT_ACCESS_SECRET` مخصّص للتطوير فقط.

### التحقق قبل الإطلاق

```bash
node -e "console.log(Buffer.from(process.env.CREDENTIALS_KEK, 'base64').length)"   # يجب أن يكون 32
curl -fsS http://localhost:3001/api/v1/health
curl -fsS http://localhost:3001/api/v1/ready
```

---

## 4. النشر بـ Docker Compose

```bash
cp .env.example .env
# عدّل: JWT_ACCESS_SECRET, CREDENTIALS_KEK, POSTGRES_PASSWORD, COOKIE_SECURE, CORS_ORIGIN
docker compose up -d --build postgres valkey api worker scheduler web
docker compose exec api pnpm db:migrate             # ترحيلات إضافية فقط
```

- الصورة `apps/api/Dockerfile` مشتركة بين API وworker وscheduler، وكل خدمة تتجاوز `command`.
- **عملية API واحدة**؛ PostgreSQL يتحمل عدة عمليات API، بينما worker واحد أو أكثر آمن لأن BullMQ يوزّع المهام، وscheduler واحد يقود القفل.
- الواجهة تُقدَّم عبر Nginx على المنفذ `8080` (Docker) أو Vite في التطوير.

### ترتيب التشغيل

1. `postgres` + `valkey` (healthchecks).
2. `pnpm db:migrate`.
3. `api` (فقط يتحقق من `ready`).
4. `scheduler` (يقود قفل Redis الواحد).
5. `worker` (يستهلك `workflow-executions`).
6. `web`.

لا تشغّل أكثر من scheduler نشط؛ القفل يمنع الازدواج لكن العملية الزائدة تظل تستهلك موارد.

---

## 5. النسخ الاحتياطي والاستعادة (≤ 1 ساعة)

### ما يُنسخ

| العنصر | الطريقة | التكرار |
|---|---|---|
| PostgreSQL (workflows, versions, executions, audit, credentials ciphertext, outbox) | `pg_dump -Fc` | يومي + شهري + سنوي، **بلا حذف تلقائي** |
| `.env` والأسرار | نسخة مشفّرة خارج الخادم | عند كل تغيير |
| Valkey | غير مطلوب للاستعادة الدائمة؛ الطابور والجلسات مؤقتة | — |

> لا تُحذف النسخ تلقائيًا. الحذف اليدوي متاح لمالك النظام فقط، ويُسجّل في سجل التدقيق (A1/A2).

### Backup

السكربت `scripts/backup-postgres.sh` ينفّذ النسخ اليومي، وينشئ أول نسخة من كل شهر وسنة كـ hardlink (بلا حذف تلقائي):

```bash
BACKUP_ROOT=/srv/madar-flow/backups ./scripts/backup-postgres.sh
```

أو يدويًا:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p /srv/madar-flow/backups
docker compose exec -T postgres pg_dump -U madar -Fc madar_flow > "/srv/madar-flow/backups/madar_flow_${STAMP}.dump"
sha256sum "/srv/madar-flow/backups/madar_flow_${STAMP}.dump" > "/srv/madar-flow/backups/madar_flow_${STAMP}.dump.sha256"
```

### Restore (هدف ≤ 1 ساعة)

```bash
# 1) أوقف api/worker/scheduler (أبقِ postgres)
docker compose stop api web

# 2) أنشئ قاعدة نظيفة
docker compose exec -T postgres dropdb -U madar --if-exists madar_flow
docker compose exec -T postgres createdb -U madar madar_flow

# 3) استعد
docker compose exec -T postgres pg_restore -U madar -d madar_flow --clean --if-exists < /srv/madar-flow/backups/madar_flow_<STAMP>.dump

# 4) تحقق ثم أعد التشغيل
docker compose start api web
curl -fsS http://localhost:3001/api/v1/ready
```

سجّل زمن كل خطوة؛ الهدف التشغيلي للـ MVP هو استعادة كاملة في أقل من ساعة على خادم واحد.

---

## 6. نافذة الصيانة (Maintenance Window)

الترحيلات إضافية ومعاملاتية (`schema_migrations`)، لكن اتبع الإجراء الآمن:

1. أعلن النافذة وأوقف الجدولة الجديدة.
2. `docker compose stop scheduler worker` (لا تنفّذ تنفيذات جديدة).
3. انتظر انتهاء التنفيذات الجارية أو ألغِها من الواجهة.
4. `pnpm db:migrate`.
5. أعد `worker` ثم `scheduler` ثم `api`/`web`.
6. تحقق من `/ready` ومن سجل التدقيق.

لا تنفّذ `DROP` أو `sync({ force: true })` أو حذف بيانات. كل الترحيلات إضافية وتحافظ على المعرّفات.

---

## 7. توقيع Webhooks

كل طلب إلى:

```
POST /api/v1/webhooks/:workspaceId/:path
```

يجب أن يحمل:

| الترويسة | القيمة |
|---|---|
| `x-madar-timestamp` | Unix seconds (UTC) — هامش 5 دقائق |
| `x-madar-signature` | `sha256=<hex>` لـ HMAC-SHA256 على `${timestamp}.${rawBody}` |
| `x-madar-delivery` | معرّف تسليم فريد لمنع التكرار (Idempotency) |

مثال Node.js:

```js
import { createHmac } from 'node:crypto';

const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ severity: 'critical', message: 'قاعدة البيانات متوقفة' });
const signature = 'sha256=' + createHmac('sha256', process.env.MADAR_WEBHOOK_SECRET)
  .update(`${timestamp}.${body}`)
  .digest('hex');

await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-madar-timestamp': timestamp,
    'x-madar-signature': signature,
    'x-madar-delivery': crypto.randomUUID(),
  },
  body,
});
```

- الاستجابة الناجحة `202` مع `{ accepted: true, executionId }` حتى لو تعذّر الإدراج الفوري في الطابور (outbox dispatcher يعيد المحاولة).
- إعادة إرسال نفس `x-madar-delivery` لا تُنشئ تنفيذًا جديدًا.
- المسارات مقيّدة بـ `[A-Za-z0-9/_-]` ويجب ألا تتكرر بين المنشورات.

---

## 8. الحدود والصيانة

### Rate limits

| النطاق | الحد |
|---|---|
| كل مسارات API | 600 طلب/دقيقة/IP |
| `/auth/register`, `/auth/login`, `/auth/mfa/*`, `/auth/refresh` | 15/دقيقة/IP |
| Webhooks | 120/دقيقة/IP |

`/health` و `/ready` مستثنيان.

### تقليم Docker (فقط)

```bash
./scripts/prune-docker.sh --dry-run   # معاينة
./scripts/prune-docker.sh             # dangling images + build cache
```

- لا `docker system prune`، لا `--volumes`، لا `-a`.
- **لا تحذف**: صورًا موسومة قيد الاستخدام، volumes، نسخًا احتياطية، تنفيذات، سجلات تدقيق، أرشيف outbox.

### الاحتفاظ بالبيانات

كل بيانات الأعمال تُحفظ إلى الأبد: الصور، الماكينات، الـ Workflows ونسخها، التنفيذات وخطواتها، سجلات النشر، الأرشيف، الاعتمادات (تُلغى ولا تُحذف)، وسجل التدقيق. لا يوجد حذف تلقائي زمني ولا سلة محذوفات.

---

## 9. المراقبة والاستكشاف

| العرض | المعنى | الإجراء |
|---|---|---|
| `/api/v1/health` | العملية حية | — |
| `/api/v1/ready` | PostgreSQL + Valkey جاهزان | راجع اتصالات الحاويات |
| `ready` يفشل فجأة | انقطاع DB/Redis | أعد تشغيل الخدمة المتوقفة، ثم تحقق من الـ migrations |
| تنفيذ عالق `running` | worker توقف أو القفل 120s | أعد تشغيل worker؛ التنفيذات idempotent عبر jobId |
| `429 rate_limited` | تجاوز الحد | انتظر `ttl` أو راجع مصدر الطلبات |
| Webhook `401` | توقيع/طابع زمني غير صالح | تحقق من السر وفرق الساعة (≤ 5 دقائق) |
| Webhook `202` بلا تنفيذ | outbox بانتظار dispatcher | تحقق من worker/outbox logs |

### سجلات

- Pino إلى stdout: `docker compose logs -f api worker scheduler`.
- خطأ فادح يُكتب إلى `error.log` إن كان المسار قابلًا للكتابة (موروث من تشغيل PM2/الخادم).
- سجل التدقيق من الواجهة: `/w/:workspaceId/audit` (مالك/مدير فقط).

---

## 10. أوامر التحقق النهائية

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck

# يتطلب PostgreSQL وValkey محليين
export TEST_DATABASE_URL=postgres://madar:madar@localhost:5432/madar_flow
pnpm --filter @madar/db db:migrate
pnpm test
```

الاختبارات المتوقعة:

- engine: 14 اختبارًا (8 أساسية + 6 قوالب).
- api: 15 اختبارًا (بما فيها القوالب والأمان وrate limiting).
- worker: اختبار واحد (فك تشفير الاعتماد ونطاق المساحة والإلغاء).
- scheduler: اختباران.
- shared: 22 اختبارًا، وdb: اختباران.

---

## 11. قائمة تحقق الإطلاق

- [ ] `JWT_ACCESS_SECRET` عشوائي وطويل.
- [ ] `CREDENTIALS_KEK` مضبوط ومحفوظ خارج الخادم.
- [ ] `COOKIE_SECURE=true` خلف HTTPS.
- [ ] `CORS_ORIGIN` محدد بدقة.
- [ ] TOTP مفعّل لحسابات owner/admin.
- [ ] نسخة احتياطية أولى نُفّذت واختُبرت استعادتها.
- [ ] `./scripts/prune-docker.sh --dry-run` يعمل.
- [ ] WF1–WF5 أُنشئت من القوالب، وروابطها واعتماداتها مضبوطة.
- [ ] WF2 نُشر بنجاح مع HMAC، واختبار توقيع خاطئ أعاد `401`.
- [ ] تنفيذ Webhook مكرر بنفس `x-madar-delivery` لم يُنشئ تنفيذًا ثانيًا.
- [ ] `/ready` أخضر بعد إعادة تشغيل كاملة.
