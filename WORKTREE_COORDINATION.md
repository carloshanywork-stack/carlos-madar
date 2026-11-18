# MADAR Multi-Agent Worktree Coordination Ledger

> هذا الملف مشترك بين وكيل الديسكتوب/الباك إند (Agent 1) ووكيل الموبايل (Agent 2) لتنسيق التغييرات ومنع أي تعارض أثناء التطوير المتزامن.

---

## 1. خريطة مساحات العمل والفروع (Worktree Topology)

| الوكيل (Agent) | الفرع (Git Branch) | مسار العمل (Working Directory) | نطاق المسؤولية الحصري (Scope Boundaries) |
|---|---|---|---|
| **Agent 1 (Desktop & Core)** | `feat/desktop-system` | `/home/carlos/Desktop/MADAR` | `desktop/`, `desktop-app/`, `server/`, `client/src/modules/admin/`, `accounting/`, `maintenance/` |
| **Agent 2 (Mobile App)** | `feat/mobile-app` | `/home/carlos/Desktop/MADAR-mobile` | `android/`, `client/src/modules/rep/`, `scripts/build-android.js` |
| **Protected Base** | `main` | - | فرع الإنتاج المحمي؛ لا يدمج فيه أي طرف إلا بعد انتهاء العمل واعتماده. |

---

## 2. بروتوكول التنسيق والرؤية اللحظية (Coordination Protocol)

1. **الرؤية المتبادلة (Zero Lag Visibility):**
   - كلا المجلدين يشتركان في نفس قاعدة بيانات `.git`.
   - لمشاهدة أحدث التعديلات والـ commits التي أنجزها وكيل الموبايل من داخل مستودع الديسكتوب:
     ```bash
     git log feat/mobile-app -n 5 --oneline
     ```
   - لمشاهدة أحدث التعديلات التي أنجزها وكيل الديسكتوب من داخل مستودع الموبايل:
     ```bash
     git log feat/desktop-system -n 5 --oneline
     ```

2. **قواعد تعديل الملفات المشتركة (Shared Files Protocol):**
   - إذا احتاج وكيل الموبايل أو وكيل السيرفر تعديل endpoint مشترك أو schema:
     1. يتم تسجيل التغيير في جدول سجل المهام أدناه.
     2. عمل commit للتعديل على الفرع الخاص.
     3. يمكن للوكيل الآخر دمج الفرع أو عمل cherry-pick للـ commit المحدد بسهولة.

3. **الدمج النهائي (Final Integration):**
   - يتم الدمج فقط عندما يطلب المالك (User) ذلك صراحة.
   - يتم التأكد من اجتياز كافة الاختبارات `npm test` وبناء حزم APK و Windows بنجاح قبل دمج الفرعين على `main`.

---

## 3. سجل المهام والتعديلات النشطة (Active Ledger)

| التاريخ والوقت | الوكيل | الفرع | الملفات المستهدفة | ملخص العمل والحالة |
|---|---|---|---|---|
| 2026-11-17 11:53 | Agent 1 (Desktop) | `feat/desktop-system` | `WORKTREE_COORDINATION.md` | تهيئة وتفعيل نظام الـ Worktrees المعزول وتوثيق البروتوكول. |
| 2026-11-17 11:53 | Agent 2 (Mobile) | `feat/mobile-app` | `madar-v2/android/*` | بدء العمل المستقل على تطبيق الموبايل في `/home/carlos/Desktop/MADAR-mobile`. |
| 2026-11-17 14:40 | Agent 1 (Desktop) | `feat/desktop-system` | `madar-v2/desktop/**`, `madar-v2/scripts/*` | بناء وتوقيع حزمة تثبيت ويندوز NSIS (.exe) وتوليد ملفات التحديث latest.yml و blockmap بنجاح. |
| 2026-11-18 14:05 | Agent 1 (Desktop) | `feat/desktop-system` | `madar-v2/desktop-app/**`, `madar-v2/dist-desktop/latest.yml` | تفعيل Live Web Sync مع كاش appData، دعم التنزيل المباشر للـ APK لمجلد Downloads، ترقية الإصدار إلى 1.0.1، وبناء حزمة التثبيت الموقعة وتحديث المانيفست. |
| 2026-11-18 14:45 | Agent 1 (Desktop) | `feat/desktop-system` | `madar-v2/desktop-app/main.cjs`, `madar-v2/dist-desktop/latest.yml` | تأمين خادم الـ Loopback المحلي برمز جلسة داخلي عشوائي (INTERNAL_TOKEN) وحقن هيدر x-madar-internal-token مع حجب المتصلين غير المصرح لهم بكود 403. |
| 2026-11-18 16:40 | Agent 1 (Desktop) | `feat/desktop-system` | `madar-v2/desktop-app/main.cjs`, `madar-v2/dist-desktop/latest.yml`, `madar-v2/scripts/build-desktop.js` | تعزيز Auto-Updater بدعم التنزيل الكامل عند تعثر التنزيل التفاضلي، رصد download-progress لشريط المهام، ونافذة حوارية لإعادة التشغيل الفوري. |
