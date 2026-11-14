package com.madar.rep.app;
import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import androidx.test.ext.junit.runners.AndroidJUnit4;
/** Pure policy checks: no database, account, files, or phone settings are mutated. */
@RunWith(AndroidJUnit4.class)
public class RepVisitPhotoPolicyInstrumentedTest {
    @Test public void preservesLegacyAndRequiresFlexibleBeforeAfter() throws Exception {
        assertTrue(RepVisitPhotoPolicy.valid(new JSONObject(), 3, 0));
        assertFalse(RepVisitPhotoPolicy.valid(new JSONObject(), 1, 1));
        JSONObject modern = new JSONObject().put("photoPolicyVersion", 2);
        assertTrue(RepVisitPhotoPolicy.valid(modern, 1, 1));
        assertTrue(RepVisitPhotoPolicy.valid(modern, 20, 20));
        assertFalse(RepVisitPhotoPolicy.valid(modern, 1, 0));
        assertFalse(RepVisitPhotoPolicy.valid(modern, 0, 1));
        assertFalse(RepVisitPhotoPolicy.valid(modern, 21, 1));
        assertFalse(RepVisitPhotoPolicy.valid(new JSONObject().put("photoPolicyVersion", "2"), 1, 1));
    }
}
