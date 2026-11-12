package com.madar.rep.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.location.Location;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;

/** Runs the actual bridge importer, SQLite migrations, evidence files, and restart behavior on Android. */
@RunWith(AndroidJUnit4.class)
public class QueueRecoveryInstrumentedTest {
    private Context context;
    private JSONObject fixture;
    @Before public void setup() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.deleteDatabase("madar_rep_local.db");
        context.deleteDatabase("madar_rep_tracking.db");
        context.deleteDatabase("madar_photo_archive.db");
        java.io.File uploads = new java.io.File(context.getFilesDir(), "MADAR");
        if (uploads.exists()) try (java.util.stream.Stream<java.nio.file.Path> paths = java.nio.file.Files.walk(uploads.toPath())) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> { try {java.nio.file.Files.delete(path);} catch(Exception e) {throw new RuntimeException(e);} });
        }
        try (java.io.InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("rep-recovery.json")) {
            fixture = new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
    }
    private int count(SQLiteDatabase db, String table) {
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM " + table, null)) {c.moveToFirst();return c.getInt(0);}
    }
    private JSONObject nativeAction(JSONObject recoveryAction) throws Exception {
        JSONObject action = new JSONObject(recoveryAction.toString());
        JSONObject evidence = action.getJSONObject("evidence");
        action.put("evidenceBase64", evidence.getString("bytesBase64"));
        action.put("evidenceMimeType", evidence.getString("mimeType"));
        return action;
    }
    @Test public void importAllQueuesRestartAndReplayWithoutDuplicates() throws Exception {
        JSONObject result = RepRecoveryImporter.importPackage(context, fixture.toString(), 41);
        assertTrue(result.getBoolean("completed"));assertEquals(4,result.getInt("imported"));
        try (RepLocalStore store = new RepLocalStore(context); RepTrackStore tracks = new RepTrackStore(context)) {
            assertEquals(1,count(store.getReadableDatabase(),"pending_visits"));
            assertEquals(1,store.listMachineActions(41).length());
            assertEquals(1,store.listAttendanceActions(41).length());
            assertEquals(1,tracks.pendingCount(41));
            assertEquals(4,count(store.getReadableDatabase(),"recovery_imports"));
            assertEquals("attendance_rejected",store.listAttendanceActions(41).getJSONObject(0).getString("status"));
        }
        result = RepRecoveryImporter.importPackage(context, fixture.toString(),41);
        assertEquals(0,result.getInt("imported"));assertEquals(4,result.getInt("duplicates"));
        // Once a restored action has synchronized, replaying the same archive must not resurrect it.
        try (RepLocalStore store = new RepLocalStore(context)) {store.getWritableDatabase().delete("pending_machine_actions",null,null);}
        RepRecoveryImporter.importPackage(context,fixture.toString(),41);
        try (RepLocalStore store = new RepLocalStore(context)) {assertEquals(0,store.listMachineActions(41).length());}
    }
    @Test public void corruptOrForeignArchiveWritesNothing() throws Exception {
        fixture.getJSONArray("pendingGpsPoints").getJSONObject(0).put("latitude",26);
        assertThrows(Exception.class,()->RepRecoveryImporter.importPackage(context,fixture.toString(),41));
        try (RepLocalStore store = new RepLocalStore(context)) {assertEquals(0,count(store.getReadableDatabase(),"pending_visits"));}
        assertThrows(Exception.class,()->RepRecoveryImporter.importPackage(context,fixture.toString(),42));
    }
    @Test public void nativeRetryPreservesIdentityAndRejectsOtherOwnersAndDecisions() throws Exception {
        JSONObject action = nativeAction(fixture.getJSONArray("machineActions").getJSONObject(0));String uuid=action.getString("actionUuid");
        try (RepLocalStore store = new RepLocalStore(context)) {
            store.enqueueMachineAction(context,action);store.markMachineActionBlocked(uuid,"Original server reason");
            assertThrows(SecurityException.class,()->store.retryMachineAction(uuid,42));
            assertTrue(store.retryMachineAction(uuid,41));
            JSONObject saved=store.listMachineActions(41).getJSONObject(0);
            assertEquals(uuid,saved.getString("actionUuid"));
            assertEquals(RepRecoveryValidator.canonical(action.getJSONObject("payload")),RepRecoveryValidator.canonical(saved.getJSONObject("payload")));
            store.updateMachineActionReview(uuid,41,"rejected",1,"Supervisor rejected");
            store.markMachineActionBlocked(uuid,"Rejected decision");
            assertThrows(IllegalStateException.class,()->store.retryMachineAction(uuid,41));
        }
    }
    @Test public void changedEvidenceNeverOverwritesQueuedBytes() throws Exception {
        JSONObject action = nativeAction(fixture.getJSONArray("machineActions").getJSONObject(0));
        String path;
        try (RepLocalStore store=new RepLocalStore(context)) {
            store.enqueueMachineAction(context,action);path=store.listMachineActions(41).getJSONObject(0).getString("evidencePath");
        }
        byte[] original=java.nio.file.Files.readAllBytes(java.nio.file.Path.of(path));
        try (RepLocalStore store=new RepLocalStore(context)) {
            action.put("evidenceBase64",Base64.encodeToString("changed evidence".getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
            assertThrows(IllegalStateException.class,()->store.enqueueMachineAction(context,action));
        }
        assertArrayEquals(original,java.nio.file.Files.readAllBytes(java.nio.file.Path.of(path)));
    }
    @Test public void additiveMigrationPreservesQueuedData() throws Exception {
        JSONObject action=nativeAction(fixture.getJSONArray("machineActions").getJSONObject(0));
        try (RepLocalStore store=new RepLocalStore(context)) {
            store.enqueueMachineAction(context,action);SQLiteDatabase db=store.getWritableDatabase();
            db.execSQL("DROP TABLE recovery_imports");db.setVersion(3);
        }
        try (RepLocalStore store=new RepLocalStore(context)) {
            assertEquals(1,store.listMachineActions(41).length());assertEquals(0,count(store.getReadableDatabase(),"recovery_imports"));
        }
    }
    @Test public void gpsWriterAndRecoveryPreserveOwnerAcrossRestart() throws Exception {
        try (RepTrackStore tracks=new RepTrackStore(context)) {
            Location point=new Location("fixture");point.setTime(1770000000000L);point.setLatitude(25);point.setLongitude(55);point.setAccuracy(8);
            assertTrue(tracks.append(point,41)>0);assertEquals(0,tracks.pendingCount(42));
        }
        try (RepTrackStore tracks=new RepTrackStore(context)) {
            assertEquals(1,tracks.recoveryQueue(41).getJSONArray("pending").length());
            assertEquals(0,tracks.recoveryQueue(42).getJSONArray("pending").length());
        }
    }
    @Test public void atomicImageFailureRetainsPreviousBytes() throws Exception {
        java.io.File file=new java.io.File(context.getCacheDir(),"atomic-photo-fixture.jpg");
        RepEvidenceFile.write(file,"original".getBytes(StandardCharsets.UTF_8));
        android.util.AtomicFile atomic=new android.util.AtomicFile(file);
        java.io.FileOutputStream pending=atomic.startWrite();pending.write("partial-new".getBytes(StandardCharsets.UTF_8));atomic.failWrite(pending);
        assertEquals("original",new String(RepEvidenceFile.read(file),StandardCharsets.UTF_8));
        RepEvidenceFile.write(file,"replacement".getBytes(StandardCharsets.UTF_8));
        assertEquals("replacement",new String(RepEvidenceFile.read(file),StandardCharsets.UTF_8));file.delete();
    }
    @Test public void trackingQueueIdentitySurvivesRestartAndVersionThreeUpgrade() throws Exception {
        String id;
        try(RepTrackStore tracks=new RepTrackStore(context)) {id=tracks.queueIdentity();}
        try(RepTrackStore tracks=new RepTrackStore(context)) {assertEquals(id,tracks.queueIdentity());tracks.getWritableDatabase().execSQL("DROP TABLE queue_identity");tracks.getWritableDatabase().setVersion(3);}
        try(RepTrackStore tracks=new RepTrackStore(context)) {assertFalse(tracks.queueIdentity().isEmpty());assertEquals(4,tracks.getReadableDatabase().getVersion());}
    }
    @Test public void archiveSnapshotSurvivesSourceDeletionAndRemainsOwnerScoped() throws Exception {
        java.io.File directory=new java.io.File(context.getFilesDir(),"MADAR/uploads/Region/2026/11/Machine/Before");assertTrue(directory.mkdirs());
        java.io.File source=new java.io.File(directory,"capture_0001.jpg");byte[] bytes="archive-fixture".getBytes(StandardCharsets.UTF_8);
        RepEvidenceFile.write(source,bytes);
        RepPhotoArchive.preserveBeforeRemoval(context,41,source);
        RepPhotoArchive.preserveBeforeRemoval(context,41,source);
        assertEquals(1,RepPhotoArchive.status(context,41).getInt("pending"));
        assertTrue(source.delete());
        assertEquals(1,RepPhotoArchive.status(context,41).getInt("pending"));assertEquals(0,RepPhotoArchive.status(context,42).getInt("pending"));
        try(RepPhotoArchive archive=new RepPhotoArchive(context);Cursor rows=archive.getReadableDatabase().rawQuery("SELECT snapshot_path,relative_path FROM photos WHERE rep_id=41",null)) {
            assertTrue(rows.moveToFirst());assertArrayEquals(bytes,RepEvidenceFile.read(new java.io.File(rows.getString(0))));
            assertEquals("Areas/Region/2026/11/Machine/Before/capture_0001.jpg",rows.getString(1));
        }
    }
}
