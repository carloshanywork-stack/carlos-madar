package com.madar.rep.app;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Validate the entire untrusted archive before any SQLite or file writes. Hashes detect corruption, not authenticity. */
final class RepRecoveryValidator {
    private static final String UUID = "(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
    static String canonical(Object value) throws Exception {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            List<String> keys = new ArrayList<>();
            object.keys().forEachRemaining(keys::add);
            Collections.sort(keys);
            List<String> entries = new ArrayList<>();
            for (String key : keys) entries.add(JSONObject.quote(key) + ":" + canonical(object.get(key)));
            return "{" + String.join(",", entries) + "}";
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            List<String> entries = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) entries.add(canonical(array.get(i)));
            return "[" + String.join(",", entries) + "]";
        }
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof String) return JSONObject.quote((String) value);
        if (value instanceof Number) return JSONObject.numberToString((Number) value);
        return value.toString();
    }
    static String hash(byte[] bytes) throws Exception {
        StringBuilder output = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) output.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return output.toString();
    }
    static String hashJson(JSONObject value) throws Exception { return hash(canonical(value).getBytes(StandardCharsets.UTF_8)); }
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }
    private static void same(Object left, Object right) throws Exception {
        require(canonical(left).equals(canonical(right)), "Recovery content does not match immutable identity.");
    }
    private static void file(JSONObject file, long limit) throws Exception {
        require(file != null && !file.has("omitted"), "Recovery evidence is missing.");
        String encoded = file.getString("bytesBase64");
        require(encoded.length() <= ((limit + 2) / 3) * 4, "Recovery evidence exceeds size limit.");
        require(encoded.matches("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"), "Malformed evidence base64.");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        require(bytes.length > 0 && bytes.length <= limit && bytes.length == file.getLong("byteSize"), "Recovery evidence size mismatch.");
        require(hash(bytes).equals(file.getString("sha256")), "Recovery evidence SHA-256 mismatch.");
    }
    static JSONObject validate(String json, long repId) throws Exception {
        require(json != null && json.getBytes(StandardCharsets.UTF_8).length <= 128L * 1024 * 1024, "Recovery package exceeds size limit.");
        JSONObject recovery = new JSONObject(json);
        require(repId > 0 && recovery.getLong("repId") == repId, "Recovery ownership mismatch.");
        require("madar-rep-recovery".equals(recovery.getString("type")) && recovery.getInt("schemaVersion") == 3, "Unsupported recovery package.");
        require(recovery.getString("localSessionId").matches(UUID), "Invalid recovery session.");
        require(recovery.getBoolean("complete") && recovery.getJSONArray("omissions").length() == 0, "Incomplete recovery package.");
        Set<String> ids = new HashSet<>();
        for (String queue : new String[] {"visits", "machineActions", "attendanceActions", "pendingGpsPoints", "rejectedGpsPoints"}) {
            JSONArray items = recovery.getJSONArray(queue);
            require(items.length() <= 20000, "Recovery item limit exceeded.");
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                require(item.getLong("repId") == repId, "Recovery item ownership mismatch.");
                require(!item.getString("provenance").trim().isEmpty(), "Missing recovery provenance.");
                String idField = queue.equals("visits") ? "visitUuid" : queue.endsWith("GpsPoints") ? "trackId" : "actionUuid";
                String id = item.getString(idField);
                require(idField.equals("trackId") ? item.getLong(idField) > 0 : id.matches(UUID), "Invalid recovery item ID.");
                require(ids.add(queue + ":" + id.toLowerCase(java.util.Locale.US)), "Duplicate recovery item ID.");
                JSONObject identity = item.getJSONObject("identity");
                same(item.get(idField), identity.get(idField));
                same(item.get("repId"), identity.get("repId"));
                require(hashJson(identity).equals(item.getString("identityHash")), "Recovery identity hash mismatch.");
                String status = item.getString("status");
                if (queue.equals("visits")) {
                    require(status.matches("queued|syncing|blocked"), "Invalid visit status.");
                    same(item.getJSONObject("payload"), identity.getJSONObject("payload"));
                    for (String phase : new String[] {"before", "after"}) {
                        JSONArray photos = item.getJSONArray(phase + "Photos");
                        JSONArray hashes = identity.getJSONArray(phase + "Hashes");
                        JSONArray times = identity.getJSONArray(phase + "CapturedAt");
                        require(phase.equals("before") ? photos.length() == 3 : photos.length() <= 3, "Invalid visit evidence count.");
                        require(hashes.length() == photos.length() && times.length() == photos.length(), "Evidence identity count mismatch.");
                        for (int k = 0; k < photos.length(); k++) {
                            JSONObject photo = photos.getJSONObject(k); file(photo, 3L * 1024 * 1024);
                            same(photo.get("sha256"), hashes.get(k)); same(photo.optString("capturedAt", ""), times.get(k));
                        }
                    }
                } else if (queue.equals("machineActions")) {
                    require(status.matches("queued|syncing|blocked|pending_approval|approved|rejected|superseded"), "Invalid machine status.");
                    for (String key : new String[] {"type", "machineId", "payload"}) same(item.get(key), identity.get(key));
                    long cardId = item.getJSONObject("payload").getLong("cardId");
                    require(cardId > 0 && item.getLong("machineId") > 0 && item.getString("type").matches("confirm_location|report_correction"), "Invalid machine action.");
                    same(cardId, identity.get("cardId"));
                    if (item.has("cardId")) same(cardId, item.get("cardId"));
                    JSONObject evidence = item.optJSONObject("evidence");
                    if (evidence != null) { file(evidence, 4L * 1024 * 1024); same(evidence.get("sha256"), identity.get("evidenceSha256")); }
                    else require(identity.isNull("evidenceSha256"), "Missing action evidence.");
                } else if (queue.equals("attendanceActions")) {
                    require(status.matches("pending_attendance_sync|attendance_rejected"), "Invalid attendance status.");
                    same(item.get("action"), identity.get("action"));
                    JSONObject payload = item.getJSONObject("payload"); same(payload, identity.getJSONObject("payload"));
                    same(item.get("actionUuid"), payload.get("actionUuid")); same(repId, payload.get("repId")); same(item.get("action"), payload.get("action"));
                    require(payload.getString("action").matches("in|out") && payload.optBoolean("biometricVerified"), "Invalid attendance payload.");
                    java.time.Instant.parse(payload.getString("occurredAt"));
                    JSONObject location = payload.getJSONObject("location");
                    require(Double.isFinite(location.getDouble("latitude")) && Math.abs(location.getDouble("latitude")) <= 90
                        && Double.isFinite(location.getDouble("longitude")) && Math.abs(location.getDouble("longitude")) <= 180
                        && location.getDouble("accuracy") >= 0 && location.getDouble("accuracy") <= 250, "Invalid attendance location.");
                } else {
                    require(status.equals(queue.equals("pendingGpsPoints") ? "pending" : "rejected"), "GPS queue status mismatch.");
                    for (String key : new String[] {"timestamp", "latitude", "longitude", "accuracy"}) same(item.get(key), identity.get(key));
                    same(item.optDouble("speed", 0), identity.get("speed")); same(item.optString("reason", ""), identity.get("reason"));
                    double lat = item.getDouble("latitude"), lon = item.getDouble("longitude"), accuracy = item.getDouble("accuracy");
                    require(Double.isFinite(lat) && Math.abs(lat) <= 90 && Double.isFinite(lon) && Math.abs(lon) <= 180
                        && Double.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100000 && Double.isFinite(item.optDouble("speed", 0)), "Invalid GPS point.");
                    require(item.getLong("timestamp") > 0 && java.time.Instant.parse(item.getString("capturedAt")).toEpochMilli() == item.getLong("timestamp"), "GPS timestamp mismatch.");
                }
            }
        }
        return recovery;
    }
}
