package com.madar.rep.app;
import android.content.Context;
import android.util.Base64;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.Locale;
/** The bridge and behavioral tests share this native recovery path. */
final class RepRecoveryImporter {
    private static final long MAX_PHOTO_BYTES = 3L * 1024L * 1024L;
    static synchronized JSObject importPackage(Context context, String packageJson, long repId) throws Exception {
JSONObject recovery = RepRecoveryValidator.validate(packageJson, repId);
            if (!"madar-rep-recovery".equals(recovery.optString("type"))
                || recovery.optInt("schemaVersion", 0) != 3 || recovery.optLong("repId", 0L) != repId
                || !recovery.optBoolean("complete", false) || recovery.optJSONArray("omissions") == null
                || recovery.optJSONArray("omissions").length() != 0) {
                throw new IllegalArgumentException("حزمة الاسترداد غير مكتملة أو غير مدعومة.");
            }
            String sessionId = recovery.getString("localSessionId");
            if (!sessionId.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) {
                throw new IllegalArgumentException("هوية جلسة الحزمة غير صالحة.");
            }
            int imported = 0;
            int duplicates = 0;
            try (RepLocalStore store = new RepLocalStore(context); RepTrackStore tracks = new RepTrackStore(context)) {
                android.database.sqlite.SQLiteDatabase localDatabase = store.getWritableDatabase();
                    localDatabase.beginTransaction();
                    try {
                    JSONArray visits = recovery.optJSONArray("visits");
                JSONArray actions = recovery.optJSONArray("machineActions");
                JSONArray attendance = recovery.optJSONArray("attendanceActions");
                JSONArray pendingGps = recovery.optJSONArray("pendingGpsPoints");
                JSONArray rejectedGps = recovery.optJSONArray("rejectedGpsPoints");
                if (visits == null || actions == null || attendance == null || pendingGps == null || rejectedGps == null) {
                    throw new IllegalArgumentException("تحتوي الحزمة على قوائم مطلوبة مفقودة.");
                }
                for (int i = 0; i < visits.length(); i++) {
                    JSONObject visit = visits.getJSONObject(i);
                    if (visit.optLong("repId", 0L) != repId) throw new SecurityException("زيارة مملوكة لحساب آخر.");
                    String uuid = visit.getString("visitUuid");
                    String existing = store.recoveryImportHash(repId, sessionId, "visit", uuid);
                    String identityHash = visit.getString("identityHash");
                    if (existing != null) {
    if (!existing.equals(identityHash)) throw new IllegalStateException("تعارض محتوى معرّف الزيارة " + uuid);
    duplicates++;
    continue;
}
if (store.assertVisitImportCompatible(repId, visit)) {
    store.recordRecoveryImport(repId, sessionId, "visit", uuid, identityHash);
    duplicates++;
    continue;
}
JSONArray before = importVisitPhotos(context, visit.optJSONArray("beforePhotos"), uuid, "before");
JSONArray after = importVisitPhotos(context, visit.optJSONArray("afterPhotos"), uuid, "after");
JSONObject nativeVisit = new JSONObject();
nativeVisit.put("visitUuid", uuid);
                    nativeVisit.put("repId", repId);
                    nativeVisit.put("repUsername", visit.optString("repUsername", ""));
                    nativeVisit.put("createdAt", visit.optString("createdAt", ""));
                    nativeVisit.put("payload", visit.getJSONObject("payload"));
                    nativeVisit.put("beforePhotos", before);
                    nativeVisit.put("afterPhotos", after);
                    store.enqueueVisit(context, nativeVisit);
                    store.restoreVisitState(uuid, repId, visit);
                    store.recordRecoveryImport(repId, sessionId, "visit", uuid, identityHash);
                    imported++;
                }
                for (int i = 0; i < actions.length(); i++) {
                    JSONObject action = actions.getJSONObject(i);
                    if (action.optLong("repId", 0L) != repId) throw new SecurityException("إجراء ماكينة مملوك لحساب آخر.");
                    String uuid = action.getString("actionUuid");
                    String hash = action.getString("identityHash");
                    String existing = store.recoveryImportHash(repId, sessionId, "machine", uuid);
                    if (existing != null) {
                        if (!existing.equals(hash)) throw new IllegalStateException("تعارض محتوى معرّف إجراء الماكينة " + uuid);
                        duplicates++;
                        continue;
                    }
                    JSONObject nativeAction = new JSONObject(action.toString());
                    JSONObject evidence = action.optJSONObject("evidence");
                    if (evidence != null) {
                        if (evidence.has("omitted") || evidence.optLong("byteSize", 0L) > 8L * 1024L * 1024L) throw new IllegalArgumentException("إثبات إجراء الماكينة مفقود أو أكبر من الحد.");
                        nativeAction.put("evidenceMimeType", evidence.optString("mimeType", "image/jpeg"));
                        nativeAction.put("evidenceBase64", evidence.getString("bytesBase64"));
                    }
                    nativeAction.remove("identity"); nativeAction.remove("identityHash"); nativeAction.remove("evidence");
                    boolean created = store.enqueueMachineAction(context, nativeAction);
                    if (created) store.restoreMachineActionState(uuid, repId, action);
                    store.recordRecoveryImport(repId, sessionId, "machine", uuid, hash);
                    imported++;
                }
                for (int i = 0; i < attendance.length(); i++) {
                    JSONObject action = attendance.getJSONObject(i);
                    if (action.optLong("repId", 0L) != repId) throw new SecurityException("تسجيل حضور مملوك لحساب آخر.");
                    String uuid = action.getString("actionUuid"); String hash = action.getString("identityHash");
                    String existing = store.recoveryImportHash(repId, sessionId, "attendance", uuid);
if (existing != null) { if (!existing.equals(hash)) throw new IllegalStateException("تعارض معرّف تسجيل الحضور " + uuid); duplicates++; continue; }
JSONObject nativeAction = action.optJSONObject("payload");
if (nativeAction == null) nativeAction = new JSONObject(action.toString());
nativeAction.put("actionUuid", uuid); nativeAction.put("repId", repId);
if (!nativeAction.optBoolean("biometricVerified", false)) throw new IllegalArgumentException("لا يمكن استيراد تسجيل حضور دون إثبات المصادقة الأصلية.");
nativeAction.remove("identity"); nativeAction.remove("identityHash"); nativeAction.remove("provenance");
nativeAction.remove("status"); nativeAction.remove("attempts"); nativeAction.remove("lastError");
boolean created = store.enqueueAttendanceAction(nativeAction);
if (created) store.restoreAttendanceActionState(uuid, repId, action);
store.recordRecoveryImport(repId, sessionId, "attendance", uuid, hash);
imported++;
    }
    for (int i = 0; i < pendingGps.length(); i++) {
        JSONObject point = pendingGps.getJSONObject(i);
        if (point.optLong("repId", 0L) != repId) throw new SecurityException("نقطة GPS معلقة مملوكة لحساب آخر.");
        String id = String.valueOf(point.optLong("trackId", 0L)); String hash = point.getString("identityHash");
        String existing = store.recoveryImportHash(repId, sessionId, "gps-pending", id);
        if (existing != null) { if (!existing.equals(hash)) throw new IllegalStateException("تعارض محتوى معرّف نقطة GPS " + id); duplicates++; continue; }
        long inserted = tracks.importPendingPoint(point, repId);
        if (inserted < 0L) throw new IllegalStateException("تعارض مع نقطة GPS محلية لها المعرّف نفسه.");
        store.recordRecoveryImport(repId, sessionId, "gps-pending", id, hash);
        if (inserted == 0L) duplicates++; else imported++;
    }
    for (int i = 0; i < rejectedGps.length(); i++) {
        JSONObject point = rejectedGps.getJSONObject(i);
        if (point.optLong("repId", 0L) != repId) throw new SecurityException("نقطة GPS مرفوضة مملوكة لحساب آخر.");
        String id = String.valueOf(point.optLong("trackId", 0L)); String hash = point.getString("identityHash");
        String existing = store.recoveryImportHash(repId, sessionId, "gps-rejected", id);
        if (existing != null) { if (!existing.equals(hash)) throw new IllegalStateException("تعارض محتوى معرّف GPS مرفوض " + id); duplicates++; continue; }
        if (!tracks.importRejectedPoint(point, repId)) throw new IllegalStateException("تعذر حفظ نقطة GPS المرفوضة.");
        store.recordRecoveryImport(repId, sessionId, "gps-rejected", id, hash);
        imported++;
    }
localDatabase.setTransactionSuccessful();
                    } finally { localDatabase.endTransaction(); }
                }
return new JSObject().put("completed", true).put("imported", imported).put("duplicates", duplicates).put("repId", repId);
            }
private static JSONArray importVisitPhotos(Context context, JSONArray photos, String uuid, String phase) throws Exception {
    JSONArray entries = new JSONArray();
    if (photos == null) throw new IllegalArgumentException("صور الزيارة مفقودة.");
    File directory = new File(new File(new File(context.getFilesDir(), "MADAR"), "uploads"), phase.equals("before") ? "Before" : "After");
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("تعذر إنشاء مجلد الاسترداد المحلي.");
    for (int i = 0; i < photos.length(); i++) {
        JSONObject photo = photos.getJSONObject(i);
        if (photo.has("omitted") || photo.optLong("byteSize", 0L) < 1L || photo.optLong("byteSize", 0L) > MAX_PHOTO_BYTES) throw new IllegalArgumentException("صورة الزيارة مفقودة أو أكبر من الحد.");
        byte[] bytes = Base64.decode(photo.getString("bytesBase64"), Base64.DEFAULT);
        if (bytes.length != photo.optInt("byteSize")) throw new IllegalArgumentException("حجم صورة الاسترداد غير مطابق.");
        String filename = uuid + "_" + String.format(Locale.US, "%04d", i + 1) + ".jpg";
        File target = new File(directory, filename).getCanonicalFile();
        if (!target.getPath().startsWith(directory.getCanonicalPath() + File.separator)) throw new SecurityException("مسار صورة الاسترداد غير آمن.");
        if (target.exists()) {
                if (!java.util.Arrays.equals(bytes, RepEvidenceFile.read(target))) throw new IllegalStateException("Existing recovery evidence has different bytes; original preserved.");
            } else {
                try (java.io.FileOutputStream output = new java.io.FileOutputStream(target)) { output.write(bytes); output.getFD().sync(); }
            }
        entries.put(new JSONObject().put("path", target.getAbsolutePath()).put("capturedAt", photo.optString("capturedAt", "")));
    }
    if ("before".equals(phase) && entries.length() != 3) throw new IllegalArgumentException("تتطلب الزيارة ثلاث صور قبل العمل.");
    if ("after".equals(phase) && entries.length() > 3) throw new IllegalArgumentException("عدد صور ما بعد العمل يتجاوز الحد.");
    return entries;
}

}
