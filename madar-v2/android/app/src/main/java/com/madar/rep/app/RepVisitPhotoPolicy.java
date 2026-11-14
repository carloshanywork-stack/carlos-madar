package com.madar.rep.app;
import org.json.JSONObject;
/** Version absent: legacy immutable queue contract. Version 2: flexible required Before/After. */
final class RepVisitPhotoPolicy {
    static final int MAX_PER_PHASE = 20;
    static boolean valid(JSONObject payload, int before, int after) {
        if (before < 0 || after < 0) return false;
        if (!payload.has("photoPolicyVersion")) return before == 3 && after <= 3;
        Object version = payload.opt("photoPolicyVersion");
        return version instanceof Number && ((Number) version).doubleValue() == 2d
            && before >= 1 && after >= 1 && before <= MAX_PER_PHASE && after <= MAX_PER_PHASE;
    }
}
