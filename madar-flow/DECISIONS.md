# سجل قرارات Madar Flow — الإصدار النهائي (v3)

> هذا الملف هو المصدر الوحيد للحقيقة. أي تعديل عليه يحتاج قرارًا صريحًا وتحديث رقم الإصدار.

- **الإصدار:** 3.0
- **التاريخ:** 2026-11-08
- **الحالة:** معتمد — بدأ التنفيذ (Phase 0)

---

## 1. المبادئ الأساسية

| المبدأ | القرار |
|---|---|
| الاستضافة | Self-hosted أولًا، ومعمارية جاهزة لـ SaaS |
| البيانات | **Forever by Default** — لا حذف آلي لبيانات الأعمال |
| اللغة | Arabic-first / RTL |
| المنصات | Desktop-first، والجوال للقراءة فقط |
| مصدر الحقيقة | PostgreSQL |
| التنفيذ | API لا ينفّذ Workflows؛ يرسلها للطابور ويعيد `202` |
| الإصدارات | غير قابلة للتعديل، وكل تنفيذ مربوط بنسخة |
| العزل | `workspace_id` من اليوم الأول |

---

## 2. قرارات المعمارية

| المجال | القرار |
|---|---|
| المستودع | Monorepo — `apps/api`, `apps/worker`, `apps/scheduler`, `apps/web`, `packages/shared`, `packages/db`, `packages/engine` |
| المحرك | مكتبة نقية + Adapters |
| الطابور | BullMQ + Valkey |
| نموذج البيانات | `Item[]` مع `json` و`binary` |
| الرسم | DAG بلا دورات |
| الفشل | Stop افتراضيًا + Retries + Error Branch |
| الدلالة | At-least-once + Idempotency |
| الواجهة | React 19 + React Flow + Vite + TypeScript |
| الحالة | Zustand + TanStack Query |
| التصميم | Tailwind + shadcn/ui، RTL |
| الخادم | Fastify + TypeScript |
| قاعدة البيانات | PostgreSQL 16+ + Drizzle |
| التعبيرات | Monaco + JSONata |
| التشفير | AES-256-GCM + Envelope |
| المصادقة | Access JWT قصير + Refresh Cookie دوّار |
| الصلاحيات | RBAC + تحقق في الـ Repository |
| الـ API | REST + OpenAPI 3.1 + `/api/v1` |
| الأخطاء | RFC 9457 + `code` + `traceId` |
| البث | SSE |
| الـ Webhooks | HMAC + Timestamp + Delivery ID |
| Node SDK | عقد TypeScript + Schema-driven UI |
| النشر | Docker Compose |
| المراقبة | Pino + OpenTelemetry + Prometheus |
| النسخ الاحتياطي | PITR + Object Versioning + KEK منفصل |

---

## 3. قرارات الأمان والموثوقية (1–20)

| # | البند | القرار المعتمد |
|---|---|---|
| 1 | MFA للمديرين | **TOTP + Recovery Codes** للمديرين فقط |
| 2 | RPO / PITR | **PITR محلي** عبر WAL Archiving على قرص منفصل (D) |
| 3 | HA | **سيرفر واحد + Restore مُختبر ≤ ساعة**، وHA في المرحلة 2 |
| 4 | النشر | **نافذة صيانة معلنة** + كتابة الـ Migrations بأسلوب Expand/Contract |
| 5 | UUID | **UUIDv7 يُولَّد في التطبيق** (PostgreSQL 16) |
| 6 | Partitioning | **الجداول الملحقة فقط** من البداية (`execution_events`, `audit_logs`) مع `created_at` |
| 7 | Circular FK | `current_version_id` يقبل NULL + إدراج مرتب داخل معاملة |
| 8 | Test Versions | `version` يقبل NULL + Partial Unique Index + Check |
| 9 | `iteration` | يُضاف الآن بقيمة افتراضية `0` |
| 10 | قفل BullMQ | `lockDuration = 120s` + تجديد القفل، ومهلة العقدة `60s` |
| 11 | Scheduler | القائد فقط يسجّل Repeatables + `jobId` ثابت |
| 12 | Refresh Token | Token Family + Grace Window (10 ثوانٍ) + تنسيق بين التبويبات |
| 13 | SSE | Stream Token قصير (60 ثانية) + تجديد قبل إعادة الاتصال |
| 14 | Webhook | `202` بعد Commit للتنفيذ + Outbox، وإلا `503` |
| 15 | بيانات التنفيذ | صلاحية `execution:read_payload` منفصلة + Redaction |
| 16 | Credentials | منع الحذف + تعطيل (Revoke) + Preflight |
| 17 | إصدارات العقد | الاحتفاظ بكل الإصدارات للأبد + Deprecation |
| 18 | Publish | معاملة ذرية واحدة + قفل على الـ Workflow |
| 19 | Rollback + Triggers | تتبع النسخة المنشورة افتراضيًا، والتثبيت اختياري |
| 20 | Outbox | أرشفة إلى جدول بارد دائم (`outbox_archive`) بدل الحذف |

---

## 4. سياسة الاحتفاظ — Forever by Default

| # | البند | القرار |
|---|---|---|
| A1 | النسخ الاحتياطي | يومي + شهري + سنوي **للأبد**، ولا تُحذف النسخ الأساسية |
| A2 | حذف الصور والملفات | **لا حذف آلي إطلاقًا**. الحذف اليدوي فقط بصلاحية أدمن + Audit |
| A3 | البيانات التقنية العابرة | تُستثنى: Sessions منتهية، Staging، Cache، Rate-limit keys، Outbox بعد الأرشفة |
| A4 | GDPR | غير مطلوب (نظام داخلي للشركات والبنوك المحلية) |
| A5 | صور Docker و Build | تُقلَّم الصور القديمة فقط، ويبقى سجل النشر وسورس الكود للأبد |
| — | سجلات التنفيذ | للأبد |
| — | سجلات النشر والتدقيق | للأبد |
| — | GPS Breadcrumbs (MADAR) | إيقاف الحذف بعد 90 يومًا — تبقى للأبد |

### قاعدة الحذف الوحيدة

```text
لا يوجد أي كود يحذف بيانات أعمال بناءً على الوقت.
الحذف قرار بشري صريح، موثّق في Audit، ومحمي بصلاحية خاصة.
```

---

## 5. أول 5 Workflows (مجموعة القبول)

| # | الاسم | Trigger | العقد | الغرض |
|---|---|---|---|---|
| WF1 | فحص صحة النظام | Manual | Set, HTTP, NoOp | إثبات المحرر + المحرك + السجلات |
| WF2 | تنبيه Webhook | Webhook (HMAC) | Set, IF, HTTP, NoOp, Error | الاستقبال + التحقق + منع التكرار |
| WF3 | تقرير يومي | Schedule | HTTP, IF, NoOp | الجدولة + Timezone + DST |
| WF4 | مزامنة مصدرين | Manual/Schedule | HTTP×2, Merge, Set, HTTP | Fan-out / Fan-in + أكبر Payload |
| WF5 | مراقبة API | Schedule | HTTP, IF, Set, Error, NoOp | Retries + Error Branch |

هذه الخمسة تُصبح Templates واختبارات E2E في Phase 5.

---

## 6. النطاق

### داخل MVP

```text
✅ محرر React Flow
✅ Workspaces + RBAC
✅ Manual / Webhook / Schedule Triggers
✅ العقد: HTTP, Set, IF, Merge, NoOp, Error
✅ Retries, Error Branch, Cancel, Re-run
✅ Credentials: API Key, Bearer, Basic, OAuth2 Client Credentials
✅ Draft + Publish + Versions + Rollback
✅ سجلات تنفيذ + SSE
✅ Docker Compose
✅ عربي / RTL
✅ تدقيق أساسي
```

### خارج MVP

```text
❌ Loops
❌ Sub-workflows
❌ Code Nodes
❌ AI Nodes
❌ Wait / Approval
❌ Plugins خارجية
❌ Collaboration
❌ SSO / SAML
❌ Billing
❌ Marketplace
❌ Mobile Editing
❌ Multi-region
❌ Kubernetes
```

---

## 7. افتراضات الفريق والترخيص والجدول

| البند | القرار |
|---|---|
| الفريق | 2–3 مطورين Full-stack |
| الجدول | 12 أسبوعًا / 6 مراحل |
| الترخيص | **Proprietary / Internal** الآن، ويُراجع قبل أي توزيع تجاري |
| الميزانية | Self-hosted على السيرفر الحالي — صفر تكلفة سحابية |

---

## 8. الـ Roadmap

| الأسبوع | المرحلة | المخرج |
|---|---|---|
| 1–2 | Phase 0 | Monorepo + Docker + Auth + Health |
| 3–4 | Phase 1 | Workflow CRUD + Editor Shell |
| 5–6 | Phase 2 | Forms + Expressions + Validation |
| 7–8 | Phase 3 | Engine + Nodes + Run UI |
| 9–10 | Phase 4 | Triggers + Credentials + Security |
| 11–12 | Phase 5 | Hardening + Templates + Launch |

---

## 9. القرارات المؤجلة صراحةً

| البند | متى يُحسم |
|---|---|
| أول 3 تكاملات خارجية | قبل Phase 4 |
| الترخيص النهائي | قبل التوزيع |
| GDPR | إذا دخل السوق الأوروبي |
| SSO / Billing | المرحلة 2 |
| Kubernetes / Multi-region | المرحلة 3 |
