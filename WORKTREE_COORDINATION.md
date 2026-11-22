# MADAR Multi-Agent Worktree Coordination Ledger

> هذا الملف هو المرجع الأساسي لتنسيق العمل بين وكلاء الذكاء الاصطناعي الثلاثة لنظام "مدار" لمنع أي تعارض أثناء التطوير المتزامن.

---

## 1. خريطة مساحات العمل والفروع (Worktree Topology)

| الوكيل (Agent) | الفرع (Git Branch) | مسار العمل (Working Directory) | نطاق المسؤولية الحصري (Scope Boundaries) | الصلاحيات المحظورة (Strict Prohibitions) |
|---|---|---|---|---|
| **Coordinator & Release Gatekeeper (الشات الرئيسي)** | `main` | `/home/carlos/Desktop/MADAR` | السيرفر الحي (`server/`), إدارة قواعد البيانات، مراجعة الكود، الدمج إلى `main`, والرفع إلى `origin/main`. | لا يكتب ميزات فرعية بنفسه أثناء عمل الوكلاء. |
| **Desktop & Windows Specialist (شات الديسكتوب)** | `feat/desktop-system` | `/home/carlos/Desktop/MADAR-desktop` | حزم الويندوز، Electron (`madar-v2/desktop-app/**`), الشهادات وسكربتات التوقيع (`sign_and_deploy.sh`, `install.ps1`). | ❌ ممنوع لمس `android/` أو `server/` أو الدمج في `main`. |
| **Mobile & Android Specialist (شات الموبايل)** | `feat/mobile-app` | `/home/carlos/Desktop/MADAR-mobile` | تطبيقات أندرويد (`madar-v2/android/**`), شاشات المناديل والمشرفين (`client/src/modules/rep/**`), سكربتات بناء الـ APK (`scripts/build-android.js`). | ❌ ممنوع لمس `desktop-app/` أو `server/` أو الدمج في `main`. |
| **Web & ERP Specialist (شات الويب والـ ERP)** | `feat/system-enhancements` | `/home/carlos/Desktop/MADAR-web` | واجهة الويب المشتركة (`madar-v2/client/**`), خدمات الـ API (`madar-v2/server/**`), وحدات الورشة والمخازن والحسابات. | ❌ ممنوع لمس `android/` الأصلي أو `desktop-app/` أو الدمج المباشر في `main`. |

---

## 2. بروتوكول التنسيق والرؤية اللحظية (Coordination Protocol)

1. **الرؤية المتبادلة (Zero Lag Visibility):**
   - كافة المجلدات تشترك في نفس قاعدة بيانات `.git`.
   - لمشاهدة أحدث تعديلات الموبايل: `git log feat/mobile-app -n 5 --oneline`
   - لمشاهدة أحدث تعديلات الديسكتوب: `git log feat/desktop-system -n 5 --oneline`
   - لمشاهدة الإنتاج الرئيسي: `git log main -n 5 --oneline`

2. **قواعد تعديل الملفات المشتركة والسيرفر (Shared Contracts):**
   - السيرفر وقاعدة البيانات يعملان من المسار الرئيسي `/home/carlos/Desktop/MADAR`.
   - إذا احتاج تطبيق الموبايل أو الديسكتوب تعديلاً في الـ API، يطلب من المنسق في الشات الرئيسي إجراء التعديل على السيرفر المركزي بنمط إضافي (Additive) آمن.

3. **الدمج النهائي (Final Integration):**
   - الوكلاء الفرعيون ينتهي عملهم بعمل `git commit` محلي على فرعهم الخاص.
   - المنسق في الشات الرئيسي هو الكيان الوحيد المخول بعمل `git merge` إلى `main` واختبار الخدمات ثم الرفع إلى `origin/main`.

---

## 3. سجل المهام والتعديلات النشطة (Active Ledger)

| التاريخ والوقت | الوكيل | الفرع | الملفات المستهدفة | ملخص العمل والحالة |
|---|---|---|---|---|
| 2026-11-17 11:53 | Desktop Agent | `feat/desktop-system` | `madar-v2/desktop-app/*` | تهيئة وتفعيل نظام الـ Worktrees، شهادات التوقيع، سكربتات التثبيت، وإشعارات الـ updater. |
| 2026-11-17 13:40 | Mobile Agent | `feat/mobile-app` | `madar-v2/android/*` | بناء نسختي Release موثقتين للمندوب والمشرف، وحل مشكلة الـ serialization الافتراضية. |
| 2026-11-17 14:12 | Coordinator | `main` | كامل النظام والـ Worktrees | تفعيل هيكلية الـ 3 Worktrees المعزولة رسمياً وتثبيت فروعها. |
| 2026-11-17 14:40 | Desktop Agent | `feat/desktop-system` | `madar-v2/desktop/**`, `madar-v2/scripts/*` | بناء وتوقيع حزمة تثبيت ويندوز NSIS (.exe) وتوليد ملفات التحديث latest.yml و blockmap بنجاح. |
| 2026-11-17 14:48 | Coordinator | `main` | دمج الفروع | دمج تعديلات الموبايل والديسكتوب بنجاح في الفرع الرئيسي main ونشرها على السيرفر. |
| 2026-11-18 14:05 | Desktop Agent | `feat/desktop-system` | `madar-v2/desktop-app/**`, `madar-v2/dist-desktop/latest.yml` | تفعيل Live Web Sync مع كاش appData، دعم التنزيل المباشر للـ APK لمجلد Downloads، ترقية الإصدار إلى 1.0.1، وبناء حزمة التثبيت الموقعة وتحديث المانيفست. |
| 2026-11-18 14:45 | Desktop Agent | `feat/desktop-system` | `madar-v2/desktop-app/main.cjs`, `madar-v2/dist-desktop/latest.yml` | تأمين خادم الـ Loopback المحلي برمز جلسة داخلي عشوائي (INTERNAL_TOKEN) وحقن هيدر x-madar-internal-token مع حجب المتصلين غير المصرح لهم بكود 403. |
| 2026-11-18 15:00 | Mobile Agent | `feat/mobile-app` | `madar-v2/android/*` | تطبيق كشف الروت وتزييف الـ GPS، وتثبيت شهادات الجذر (Root CA Pins) لـ Tailscale، وبناء وتوقيع Release APK v2.4.6. |
| 2026-11-18 15:08 | Coordinator | `main` | كامل النظام والإنتاج | دمج فروع الديسكتوب والموبايل، قفل صيانة الاستعادة للسيرفر، بناء واجهة الويب، تحديث جدول الإصدارات، واجتياز الاختبارات بالكامل. |
| 2026-11-18 16:40 | Desktop Agent | `feat/desktop-system` | `madar-v2/desktop-app/main.cjs`, `madar-v2/dist-desktop/latest.yml`, `madar-v2/scripts/build-desktop.js` | تعزيز Auto-Updater بدعم التنزيل الكامل عند تعثر التنزيل التفاضلي، رصد download-progress لشريط المهام، ونافذة حوارية لإعادة التشغيل الفوري. |
| 2026-11-18 16:42 | Mobile Agent | `feat/mobile-app` | `madar-v2/android/*` | نافذة الصلاحيات الترحيبية عند أول تشغيل، استقرار مسودة الزيارة وتزويد الشاشة بـ SnackbarHost، والتسمية التسلسلية للصور في المعرض وبناء APK Build 26. |
| 2026-11-18 16:45 | Coordinator | `main` | كامل النظام والإنتاج | دمج فروع الديسكتوب والموبايل، دعم HTTP Range لملفات الديسكتوب، تحديث سجل وتوزيع حزم APK والديسكتوب، والتحقق الشامل من السيرفر. |
| 2026-11-18 17:10 | Mobile Agent | `feat/mobile-app` | `madar-v2/android/version.properties`, `madar-rep-release.apk` | ترقية رقم الإصدار إلى Build 27 (v2.4.7)، وبناء وتوقيع حزمة الـ Release الرسمية وحل مشكلة عدم ظهور التحديث لدى المناديب. |
| 2026-11-18 17:22 | Desktop Agent | `feat/desktop-system` | `madar-v2/desktop-app/main.cjs`, `madar-v2/dist-desktop/*` | تعطيل verifyUpdateCodeSignature لدعم التحديث التلقائي مع الشهادات الداخلية، وإعادة بناء وتوقيع حزمة الديسكتوب 1.0.1. |
| 2026-11-18 17:25 | Coordinator | `main` | كامل الإنتاج والمزامنة | دمج Build 27 للـ APK وتسجيلها في جدول apk_releases وتحديث الـ status، دمج حزمة الديسكتوب 1.0.1 والتحقق الشامل من السيرفر. |
| 2026-11-22 12:37 | Coordinator | `main` | كامل نظام الورشة والمخازن والويب | دمج feat/system-enhancements (53b9d03): تسعير اللوحات البارامتري، حجز الخامات، فضلات التقطيع، واجهة الفنيين، واجتياز 27 اختباراً بنجاح، وتحديث الإنتاج. |
