package com.madar.rep.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.List;
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
                RepLocalStore.Visit visit = store.nextVisit(repId);
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

    private static Response withBearerToken(Interceptor.Chain chain, String token) throws IOException {
        Request request = chain.request().newBuilder()
            .header("Authorization", "Bearer " + token)
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
        FileRequestBody(File file) { this.file = file; }
        @Override public MediaType contentType() { return JPEG; }
        @Override public long contentLength() { return file.length(); }
        @Override public void writeTo(BufferedSink sink) throws IOException {
            try (Source source = Okio.source(file)) { sink.writeAll(source); }
        }
    }
}
