package com.madar.rep.app;

import android.content.Context;
import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.TimeUnit;

import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;
import okio.Okio;
import okio.Source;

/** Retries complete visit bundles with the original UUID until the server commits them. */
public final class MadarSyncWorker extends Worker {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final MediaType JPEG = MediaType.parse("image/jpeg");
    private static final long MAX_FILE_BYTES = 3L * 1024L * 1024L;
    private static final ReentrantLock SYNC_LOCK = new ReentrantLock();

    public MadarSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!SYNC_LOCK.tryLock()) return Result.retry();
        try {
            return runSync();
        } finally {
            SYNC_LOCK.unlock();
        }
    }

    private Result runSync() {
        Context context = getApplicationContext();
        String token = RepAuthStore.token(context);
        long repId = RepAuthStore.repId(context);
        if (token == null || token.trim().isEmpty() || repId < 1L) return Result.success();

        String baseUrl = BuildConfig.REP_SERVER_URL.replaceAll("/+$", "");
        OkHttpClient client = new OkHttpClient.Builder()
            .addInterceptor(chain -> withBearerToken(chain, token))
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(75, TimeUnit.SECONDS)
            .writeTimeout(75, TimeUnit.SECONDS)
            .callTimeout(100, TimeUnit.SECONDS)
            .build();

        try (RepLocalStore store = new RepLocalStore(context)) {
            Request health = new Request.Builder().url(baseUrl + "/api/health").get().build();
            try (Response response = client.newCall(health).execute()) {
                if (!response.isSuccessful()) return Result.retry();
            }

            while (!isStopped()) {
                Result machineResult = processMachineActions(baseUrl, client, store, repId);
                if (machineResult != null) return machineResult;

                Result trackResult = flushTracking(context, baseUrl, client, store, repId);
                if (trackResult != null) return trackResult;
                RepLocalStore.AttendanceAction attendanceAction = store.nextAttendanceAction(repId);
                if (attendanceAction == null) break;
                JSONObject attendancePayload = new JSONObject()
                    .put("actionUuid", attendanceAction.actionUuid)
                    .put("action", attendanceAction.payload.getString("action"))
                    .put("occurredAt", attendanceAction.payload.getString("occurredAt"))
                    .put("location", attendanceAction.payload.optJSONObject("location"))
                    .put("biometricVerified", attendanceAction.payload.optBoolean("biometricVerified", false));
                Request attendanceRequest = new Request.Builder()
                    .url(baseUrl + "/api/rep/attendance/sync")
                    .post(RequestBody.create(attendancePayload.toString(), JSON))
                    .build();
                try (Response response = client.newCall(attendanceRequest).execute()) {
                    JSONObject result = parseJson(responseBody(response.body()));
                    boolean committed = response.code() == 200
                        && result != null
                        && result.optBoolean("success", false)
                        && attendanceAction.actionUuid.equalsIgnoreCase(result.optString("actionUuid", ""))
                        && result.optJSONObject("attendance") != null;
                    if (committed) {
                        store.deleteAttendanceAction(attendanceAction.actionUuid, repId);
                        continue;
                    }
                    String serverMessage = result == null ? ""
                        : result.optString("message", result.optString("error", ""));
                    if (response.code() == 401 || response.code() == 403) {
                        store.markAttendanceRetry(attendanceAction.actionUuid,
                            "الجلسة غير صالحة أو تحتاج مراجعة؛ أعد تسجيل الدخول للمزامنة.");
                        return Result.success();
                    }
                    if (response.code() >= 400 && response.code() < 500
                        && response.code() != 408 && response.code() != 425 && response.code() != 429) {
                        // A permanently rejected clock-in/out must not run before every
                        // later visit forever. Isolate it for review and keep going.
                        store.markAttendanceRejected(attendanceAction.actionUuid,
                            serverMessage.isEmpty()
                                ? "رفض الخادم تسجيل الحضور (" + response.code() + ")؛ يحتاج مراجعة."
                                : serverMessage);
                        continue;
                    }
                    store.markAttendanceRetry(attendanceAction.actionUuid,
                        response.code() == 202
                            ? "الخادم ما زال يعالج تسجيل الحضور؛ سيُعاد بنفس رقم العملية."
                            : "لم يؤكد الخادم تسجيل الحضور؛ سيبقى محفوظاً على الهاتف.");
                    return Result.retry();
                } catch (IOException error) {
                    store.markAttendanceRetry(attendanceAction.actionUuid,
                        "انقطع الاتصال أثناء مزامنة الحضور؛ سيُعاد بنفس رقم العملية.");
                    return Result.retry();
                }
            }

            Set<Long> blockedCardIds = store.blockingMachineCardIds(repId);
            while (!isStopped()) {
                RepLocalStore.Visit visit = store.nextVisit(repId, blockedCardIds);
                if (visit == null) return Result.success();
                for (RepLocalStore.Photo photo : visit.photos) {
                    File file = new File(photo.path);
                    if (!file.isFile() || file.length() < 1L || file.length() > MAX_FILE_BYTES) {
                        store.markBlocked(visit.visitUuid, "صورة الزيارة المحلية مفقودة أو غير صالحة؛ لم تُحذف بيانات الزيارة.");
                        visit = null;
                        break;
                    }
                }
                if (visit == null) continue;
                int expectedBeforeCount = 0;
                int expectedAfterCount = 0;
                for (RepLocalStore.Photo photo : visit.photos) {
                    if ("before".equals(photo.phase)) expectedBeforeCount += 1;
                    else if ("after".equals(photo.phase)) expectedAfterCount += 1;
                }
                if (expectedBeforeCount != 3 || expectedAfterCount > 3 || visit.photos.size() != expectedBeforeCount + expectedAfterCount) {
                    store.markBlocked(visit.visitUuid, "يلزم وجود 3 صور قبل الصيانة؛ صور بعد الصيانة اختيارية (حتى 3). لم تُحذف البيانات المحلية.");
                    continue;
                }

                store.markUploading(visit.visitUuid);
                MultipartBody.Builder multipart = new MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("visit", null, RequestBody.create(visit.payload.toString(), JSON));
                int beforeCount = 0;
                int afterCount = 0;
                for (RepLocalStore.Photo photo : visit.photos) {
                    String field = "before".equals(photo.phase) ? "beforePhoto" : "afterPhoto";
                    String filename = photo.phase + "_" + photo.index + ".jpg";
                    multipart.addFormDataPart(field, filename, new FileRequestBody(new File(photo.path)));
                    if ("before".equals(photo.phase)) beforeCount += 1;
                    else if ("after".equals(photo.phase)) afterCount += 1;
                }
                if (beforeCount != 3 || afterCount > 3) {
                    store.markBlocked(visit.visitUuid, "ترتيب صور قبل/بعد غير صالح؛ لم تُحذف البيانات المحلية.");
                    continue;
                }

                Request upload = new Request.Builder()
                    .url(baseUrl + "/api/rep/sync-visit")
                    .post(multipart.build())
                    .build();
                try (Response response = client.newCall(upload).execute()) {
                    String responseText = responseBody(response.body());
                    JSONObject result = parseJson(responseText);
                    if (response.code() == 202) {
                        store.markRetry(visit.visitUuid, "الخادم ما زال يعالج الزيارة؛ ستُعاد الحزمة كاملة بنفس رقم الزيارة.");
                        return Result.retry();
                    }
                    if (response.code() == 200
                        && result != null
                        && result.optBoolean("success", false)
                        && visit.visitUuid.equalsIgnoreCase(result.optString("visitUuid", ""))
                        && isCommittedStatus(result.optString("status", ""))) {
                        List<String> paths = store.markSynced(visit.visitUuid);
                        for (String path : paths) {
                            File photo = new File(path);
                            File parent = photo.getParentFile();
                            photo.delete();
                            if (parent != null) parent.delete();
                        }
                        continue;
                    }

                    if (response.code() == 401 || response.code() == 403) {
                        store.markRetry(visit.visitUuid, "الجلسة غير صالحة أو تحتاج مراجعة؛ أعد تسجيل الدخول للمزامنة.");
                        return Result.success();
                    }
                    if (response.code() >= 400 && response.code() < 500
                        && response.code() != 408 && response.code() != 425 && response.code() != 429) {
                        String message = result == null ? "رفض الخادم الزيارة (" + response.code() + ")."
                            : result.optString("message", result.optString("error", "رفض الخادم الزيارة (" + response.code() + ")."));
                        store.markBlocked(visit.visitUuid, message);
                        continue;
                    }
                    store.markRetry(visit.visitUuid, "لم يؤكد الخادم اكتمال الزيارة؛ ستظل الصور محفوظة على الهاتف.");
                    return Result.retry();
                } catch (IOException error) {
                    store.markRetry(visit.visitUuid, "انقطع الاتصال أثناء رفع الحزمة؛ ستُعاد الصور كاملة بنفس UUID.");
                    return Result.retry();
                }
            }
            return Result.retry();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    /**
     * Drain machine actions before any dependent visit. Location confirmations stay
     * pending until supervisor approval; correction reports are removed once the
     * server confirms the durable request.
     */
    private Result processMachineActions(String baseUrl, OkHttpClient client,
        RepLocalStore store, long repId) {
        try {
            while (!isStopped()) {
                RepLocalStore.MachineAction action = store.nextMachineAction(repId);
                if (action == null) {
                    refreshMachineActionReviews(baseUrl, client, store, repId);
                    return null;
                }
                store.markMachineActionSyncing(action.actionUuid);
                if ("confirm_location".equals(action.type)) {
                    Request request = new Request.Builder()
                        .url(baseUrl + "/api/rep/machines/" + action.machineId + "/confirm-location")
                        .post(RequestBody.create(action.payload.toString(), JSON))
                        .build();
                    try (Response response = client.newCall(request).execute()) {
                        JSONObject result = parseJson(responseBody(response.body()));
                        if ((response.code() == 200 || response.code() == 201) && result != null && result.optBoolean("success", false)) {
                            long correctionId = result.optLong("correctionId", result.optLong("id", 0L));
                            String status = result.optString("status", "pending");
            String localStatus = "approved".equals(status) || "rejected".equals(status)
                ? status : "pending_approval";
            store.markMachineActionPendingApproval(action.actionUuid, correctionId, status);
            if (!"pending_approval".equals(localStatus)) {
                store.updateMachineActionReview(action.actionUuid, repId, localStatus, correctionId, "");
            }
            continue;
        }
        String message = result == null ? ""
                            : result.optString("message", result.optString("error", ""));
                        if (response.code() == 401 || response.code() == 403) {
                            store.markMachineActionRetry(action.actionUuid,
                                "الجلسة غير صالحة أو تحتاج مراجعة؛ أعد تسجيل الدخول للمزامنة.");
                            return Result.success();
                        }
                        if (isPermanentClientError(response.code())) {
                            store.markMachineActionBlocked(action.actionUuid, message.isEmpty()
                                ? "رفض الخادم اقتراح الموقع (" + response.code() + ")؛ يحتاج مراجعة."
                                : message);
                            continue;
                        }
                        store.markMachineActionRetry(action.actionUuid,
                            "لم يؤكد الخادم اقتراح الموقع؛ سيبقى محفوظاً على الهاتف.");
                        return Result.retry();
                    } catch (IOException error) {
                        store.markMachineActionRetry(action.actionUuid,
                            "انقطع الاتصال أثناء إرسال اقتراح الموقع؛ سيبقى محفوظاً على الهاتف.");
                        return Result.retry();
                    }
                }

                File evidence = action.evidencePath == null || action.evidencePath.isEmpty()
                    ? null : new File(action.evidencePath);
                if (evidence != null && (!evidence.isFile() || evidence.length() < 1L
                    || evidence.length() > 4L * 1024L * 1024L)) {
                    store.markMachineActionBlocked(action.actionUuid,
                        "صورة إثبات بلاغ الماكينة مفقودة أو غير صالحة؛ لم يُحذف البلاغ.");
                    continue;
                }
                MultipartBody.Builder multipart = new MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("correction", null, RequestBody.create(action.payload.toString(), JSON));
                if (evidence != null) {
                    MediaType contentType = MediaType.parse(action.evidenceContentType);
                    multipart.addFormDataPart("evidence", action.actionUuid + ".jpg",
                        new FileRequestBody(evidence, contentType == null ? JPEG : contentType));
                }
                Request request = new Request.Builder()
                    .url(baseUrl + "/api/rep/machines/" + action.machineId + "/corrections")
                    .post(multipart.build())
                    .build();
                try (Response response = client.newCall(request).execute()) {
                    JSONObject result = parseJson(responseBody(response.body()));
                    if ((response.code() == 200 || response.code() == 201) && result != null && result.optBoolean("success", false)) {
                        store.supersedeMachineActions(repId, action.cardId, "report_correction", action.actionUuid);
                        store.deleteMachineAction(action.actionUuid, repId);
                        continue;
                    }
                    String message = result == null ? ""
                        : result.optString("message", result.optString("error", ""));
                    if (response.code() == 401 || response.code() == 403) {
                        store.markMachineActionRetry(action.actionUuid,
                            "الجلسة غير صالحة أو تحتاج مراجعة؛ أعد تسجيل الدخول للمزامنة.");
                        return Result.success();
                    }
                    if (isPermanentClientError(response.code())) {
                        store.markMachineActionBlocked(action.actionUuid, message.isEmpty()
                            ? "رفض الخادم بلاغ الماكينة (" + response.code() + ")؛ يحتاج مراجعة."
                            : message);
                        continue;
                    }
                    store.markMachineActionRetry(action.actionUuid,
                        "لم يؤكد الخادم بلاغ الماكينة؛ سيبقى محفوظاً على الهاتف.");
                    return Result.retry();
                } catch (IOException error) {
                    store.markMachineActionRetry(action.actionUuid,
                        "انقطع الاتصال أثناء إرسال بلاغ الماكينة؛ سيبقى محفوظاً على الهاتف.");
                    return Result.retry();
                }
            }
            return null;
        } catch (Exception error) {
            return Result.retry();
        }
    }

    /** Refresh approval state without letting a review lookup failure block local work. */
    private void refreshMachineActionReviews(String baseUrl, OkHttpClient client,
        RepLocalStore store, long repId) {
        try {
            Request request = new Request.Builder()
                .url(baseUrl + "/api/rep/location-confirmations")
                .get()
                .build();
            try (Response response = client.newCall(request).execute()) {
                if (response.code() != 200) return;
                JSONObject body = parseJson(responseBody(response.body()));
                JSONArray reviews = body == null ? null : body.optJSONArray("requests");
                if (reviews == null) return;
                Map<String, JSONObject> byAction = new HashMap<>();
                for (int index = 0; index < reviews.length(); index += 1) {
                    JSONObject review = reviews.optJSONObject(index);
                    if (review != null && !review.optString("actionUuid", "").isEmpty()) {
                        byAction.put(review.optString("actionUuid"), review);
                    }
                }
                JSONArray localActions = store.listMachineActions(repId);
                for (int index = 0; index < localActions.length(); index += 1) {
                    JSONObject local = localActions.optJSONObject(index);
                    if (local == null || !"confirm_location".equals(local.optString("type"))) continue;
    if (!"pending_approval".equals(local.optString("status"))) continue;
    JSONObject review = byAction.get(local.optString("actionUuid"));
    if (review == null) continue;
    String status = review.optString("status", "pending");
    store.updateMachineActionReview(local.optString("actionUuid"), repId,
        "pending".equals(status) ? "pending_approval" : status,
        review.optLong("id", local.optLong("correctionId", 0L)),
        review.optString("reviewNote", ""));
}
            }
        } catch (Exception ignored) {
            // The next WorkManager run reconciles review state again.
        }
    }

    private static boolean isPermanentClientError(int code) {
        return code >= 400 && code < 500
            && code != 401 && code != 403 && code != 408 && code != 425 && code != 429;
    }

    /** Flush native SQLite breadcrumbs before an offline clock-out is committed. */
    private Result flushTracking(Context context, String baseUrl, OkHttpClient client,
        RepLocalStore localStore, long repId) {
        try (RepTrackStore trackStore = new RepTrackStore(context)) {
            RepLocalStore.AttendanceAction pendingAttendance = localStore.nextAttendanceAction(repId);
            boolean closeDuty = pendingAttendance != null && "out".equals(pendingAttendance.payload.optString("action"));
            boolean startDuty = pendingAttendance != null && "in".equals(pendingAttendance.payload.optString("action"));
            JSONArray trail = trackStore.pendingTrail(repId);
            for (int offset = 0; offset < trail.length(); offset += 450) {
                JSONArray batch = new JSONArray();
                JSONArray batchSources = new JSONArray();
                long lastTrackId = 0L;
                int end = Math.min(trail.length(), offset + 450);
                for (int index = offset; index < end; index += 1) {
                    JSONObject source = trail.getJSONObject(index);
                    long trackId = source.getLong("trackId");
                    String clientPointId = "rep-" + repId + "-track-" + trackId;
                    SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                    iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                    JSONObject point = new JSONObject()
                        .put("clientPointId", clientPointId)
                        .put("latitude", source.getDouble("latitude"))
                        .put("longitude", source.getDouble("longitude"))
                        .put("accuracy", source.getDouble("accuracy"))
                        .put("speed", source.optDouble("speed", 0.0))
                        .put("updatedAt", iso.format(new Date(source.getLong("timestamp"))));
                    batch.put(point);
                    batchSources.put(new JSONObject().put("trackId", trackId).put("clientPointId", clientPointId));
                    lastTrackId = trackId;
                }
                JSONObject payload = new JSONObject().put("onDuty", true).put("trail", batch);
                JSONObject response = postTracking(client, baseUrl, payload);
                if (response == null) return Result.retry();
                acknowledgeTrackingBatch(trackStore, response, batchSources, batch.length(), lastTrackId, repId);
            }

            // Points may be appended while the initial snapshot is uploading.
            // Never close duty or stop the service until every row is acked.
            if (trackStore.pendingCount(repId) > 0) return Result.retry();

            if (startDuty) {
                JSONObject sourceLocation = pendingAttendance.payload.optJSONObject("location");
                if (sourceLocation != null) {
                    JSONObject startPayload = new JSONObject()
                        .put("onDuty", true)
                        .put("trail", new JSONArray())
                        .put("location", new JSONObject()
                            .put("latitude", sourceLocation.getDouble("latitude"))
                            .put("longitude", sourceLocation.getDouble("longitude"))
                            .put("accuracy", sourceLocation.getDouble("accuracy"))
                            .put("updatedAt", sourceLocation.getString("updatedAt")));
                    if (postTracking(client, baseUrl, startPayload) == null) return Result.retry();
                }
            }

            if (closeDuty) {
                JSONObject closePayload = new JSONObject()
                    .put("onDuty", false)
                    .put("trail", new JSONArray());
                JSONObject location = pendingAttendance.payload.optJSONObject("location");
                if (location != null) {
                    closePayload.put("location", new JSONObject()
                        .put("latitude", location.getDouble("latitude"))
                        .put("longitude", location.getDouble("longitude"))
                        .put("accuracy", location.getDouble("accuracy"))
                        .put("updatedAt", location.getString("updatedAt")));
                }
                if (postTracking(client, baseUrl, closePayload) == null) return Result.retry();
                Intent stopTracking = new Intent(context, RepLocationService.class);
                stopTracking.setAction(RepLocationService.ACTION_STOP);
                try {
                    context.startService(stopTracking);
                } catch (Exception error) {
                    // The service also guards its STOP action against an
                    // unacknowledged queue and retries through WorkManager.
                    return Result.retry();
                }
            }
            return null;
        } catch (Exception error) {
            return Result.retry();
        }
    }

    /**
     * A 200 response is not enough: only points explicitly accepted (or already
     * stored) are removed. Rejected points move to a review table with the reason.
     */
    private void acknowledgeTrackingBatch(RepTrackStore trackStore, JSONObject response,
        JSONArray sources, int batchSize, long lastTrackId, long repId) throws Exception {
        JSONArray results = response.optJSONArray("points");
        if (results == null) {
            if (response.optInt("acceptedPoints", 0) == batchSize && lastTrackId > 0L) {
                trackStore.acknowledgeThrough(lastTrackId, repId);
            }
            return;
        }
        Map<String, JSONObject> byPointId = new HashMap<>();
        for (int index = 0; index < results.length(); index += 1) {
            JSONObject result = results.optJSONObject(index);
            if (result != null) byPointId.put(result.optString("clientPointId", ""), result);
        }
        for (int index = 0; index < sources.length(); index += 1) {
            JSONObject source = sources.getJSONObject(index);
            long trackId = source.getLong("trackId");
            JSONObject result = byPointId.get(source.optString("clientPointId", ""));
            if (result == null) continue;
            String status = result.optString("status", "");
            if ("accepted".equals(status) || "duplicate".equals(status)) {
                trackStore.acknowledgePoint(trackId, repId);
            } else if ("rejected".equals(status)) {
                String reason = result.optString("reason", "");
                trackStore.rejectPoint(trackId, repId,
                    reason.isEmpty() ? "رفض الخادم نقطة GPS دون سبب." : reason);
            }
        }
    }

    private static JSONObject postTracking(OkHttpClient client, String baseUrl, JSONObject payload) {
        Request request = new Request.Builder()
            .url(baseUrl + "/api/rep/location-ping")
            .post(RequestBody.create(payload.toString(), JSON))
            .build();
        try (Response response = client.newCall(request).execute()) {
            JSONObject body = parseJson(responseBody(response.body()));
            return response.code() == 200 && body != null && body.optBoolean("success", false) ? body : null;
        } catch (IOException error) {
            return null;
        }
    }

    private static Response withBearerToken(Interceptor.Chain chain, String token) throws IOException {
        Request request = chain.request().newBuilder()
            .header("Authorization", "Bearer " + token)
            .header("x-madar-native-client", "android")
            .build();
        return chain.proceed(request);
    }

    private static boolean isCommittedStatus(String status) {
        return "pending_review".equals(status) || "approved".equals(status) || "reshoot_requested".equals(status);
    }

    private static String responseBody(ResponseBody body) throws IOException {
        return body == null ? "" : body.string();
    }

    private static JSONObject parseJson(String value) {
        try { return new JSONObject(value); }
        catch (Exception ignored) { return null; }
    }

    private static final class FileRequestBody extends RequestBody {
        private final File file;
        private final MediaType mediaType;
        FileRequestBody(File file) { this(file, JPEG); }
        FileRequestBody(File file, MediaType mediaType) { this.file = file; this.mediaType = mediaType; }
        @Override public MediaType contentType() { return mediaType; }
        @Override public long contentLength() { return file.length(); }
        @Override public void writeTo(BufferedSink sink) throws IOException {
            try (Source source = Okio.source(file)) { sink.writeAll(source); }
        }
    }
}
