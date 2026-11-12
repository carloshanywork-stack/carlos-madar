package com.madar.rep.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.net.Uri;
import android.provider.DocumentsContract;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/** User-selected SAF tree. Each capture has an immutable private snapshot until its verified external copy exists. */
final class RepPhotoArchive extends SQLiteOpenHelper {
    private final Context context;
    RepPhotoArchive(Context context) {super(context.getApplicationContext(),"madar_photo_archive.db",null,1);this.context=context.getApplicationContext();}
    @Override public void onCreate(SQLiteDatabase db) {db.execSQL("CREATE TABLE photos (id TEXT PRIMARY KEY,rep_id INTEGER NOT NULL,source_path TEXT NOT NULL,snapshot_path TEXT NOT NULL,relative_path TEXT NOT NULL,sha256 TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',last_error TEXT NOT NULL DEFAULT '',document_uri TEXT NOT NULL DEFAULT '')");}
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) {}
    static Uri tree(Context context,long owner) {
        String value=context.getSharedPreferences("madar_photo_archive",Context.MODE_PRIVATE).getString("tree:"+owner,"");
        if(value.isEmpty())return null;
        Uri uri=Uri.parse(value);
        for(android.content.UriPermission p:context.getContentResolver().getPersistedUriPermissions()) if(p.getUri().equals(uri)&&p.isWritePermission()&&p.isReadPermission())return uri;
        return null;
    }
    static void select(Context context,long owner,Uri uri,int flags) {
        if(!"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri) || (flags & 3)!=3)throw new SecurityException("A readable and writable local folder is required");
        context.getContentResolver().takePersistableUriPermission(uri,flags & (Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        if(!context.getSharedPreferences("madar_photo_archive",Context.MODE_PRIVATE).edit().putString("tree:"+owner,uri.toString()).commit()) throw new IllegalStateException("Could not retain archive folder selection");
    }
    static synchronized void enqueue(Context context,long owner,File source) throws Exception {
        if(owner<1)throw new SecurityException("Archive owner required");
        File uploads=new File(context.getFilesDir(),"MADAR/uploads").getCanonicalFile();
        File actual=source.getCanonicalFile();
        if(!actual.getPath().startsWith(uploads.getPath()+File.separator))throw new SecurityException("Archive source is outside photo storage");
        String relative="Areas/"+actual.getPath().substring(uploads.getPath().length()+1).replace(File.separatorChar,'/');
        byte[] bytes=RepEvidenceFile.read(actual);
        File snapshots=new File(context.getFilesDir(),"MADAR/photo-archive");
        if(!snapshots.isDirectory()&&!snapshots.mkdirs())throw new java.io.IOException("Could not preserve archive snapshot");
        String id=UUID.randomUUID().toString();File snapshot=new File(snapshots,id+".jpg");RepEvidenceFile.write(snapshot,bytes);
        try(RepPhotoArchive archive=new RepPhotoArchive(context)) {
            ContentValues row=new ContentValues();row.put("id",id);row.put("rep_id",owner);row.put("source_path",actual.getPath());row.put("snapshot_path",snapshot.getPath());row.put("relative_path",relative);row.put("sha256",RepRecoveryValidator.hash(bytes));
            archive.getWritableDatabase().insertOrThrow("photos",null,row);
        }
    }
    /** Queue cleanup may remove a source only after a durable snapshot or verified mirror is recorded. */
    static synchronized void preserveBeforeRemoval(Context context,long owner,File source) throws Exception {
        String hash=RepRecoveryValidator.hash(RepEvidenceFile.read(source));
        try(RepPhotoArchive archive=new RepPhotoArchive(context);Cursor rows=archive.getReadableDatabase().rawQuery(
            "SELECT snapshot_path,status FROM photos WHERE rep_id=? AND source_path=? AND sha256=?",
            new String[]{String.valueOf(owner),source.getCanonicalPath(),hash})) {
            while(rows.moveToNext()) {
                if("mirrored".equals(rows.getString(1)))return;
                File snapshot=new File(rows.getString(0));
                if(snapshot.isFile() && hash.equals(RepRecoveryValidator.hash(RepEvidenceFile.read(snapshot))))return;
            }
        }
        enqueue(context,owner,source);
    }
    static JSObject status(Context context,long owner) {
        int pending=0;String error="";
        try(RepPhotoArchive archive=new RepPhotoArchive(context);Cursor rows=archive.getReadableDatabase().rawQuery("SELECT last_error FROM photos WHERE rep_id=? AND status='pending'",new String[]{String.valueOf(owner)})) {
            pending=rows.getCount();while(rows.moveToNext())if(!rows.getString(0).isEmpty())error=rows.getString(0);
        }
        return new JSObject().put("configured",tree(context,owner)!=null).put("pending",pending).put("error",error);
    }
    static synchronized void flush(Context context,long owner) {
        Uri tree=tree(context,owner);if(tree==null)return;
        try(RepPhotoArchive archive=new RepPhotoArchive(context);Cursor rows=archive.getReadableDatabase().rawQuery("SELECT id,snapshot_path,relative_path,sha256 FROM photos WHERE rep_id=? AND status='pending' ORDER BY rowid LIMIT 20",new String[]{String.valueOf(owner)})) {
            while(rows.moveToNext()) {
                String id=rows.getString(0);ContentValues update=new ContentValues();
                try {
                    if(RepAuthStore.repId(context)!=owner)break;
                    File snapshot=new File(rows.getString(1));byte[] bytes=RepEvidenceFile.read(snapshot);String hash=rows.getString(3);
                    if(!RepRecoveryValidator.hash(bytes).equals(hash))throw new java.io.IOException("Archive snapshot integrity check failed; original retained");
                    Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
                    String[] path=rows.getString(2).split("/");
                    for(int i=0;i<path.length-1;i++)parent=directory(context.getContentResolver(),tree,parent,path[i]);
                    String name=path[path.length-1];Uri existing=find(context.getContentResolver(),tree,parent,name);
                    if(existing!=null && !matches(context.getContentResolver(),existing,hash)) {
                        // Preserve an earlier capture of this slot, rather than deleting it before replacing it.
                        String version=name.substring(0,name.length()-4)+"_"+hash.substring(0,12)+".jpg";
                        name=version;existing=find(context.getContentResolver(),tree,parent,name);
                    }
                    Uri document=existing;
                    if(document==null) {
                        Uri temporary=DocumentsContract.createDocument(context.getContentResolver(),parent,"image/jpeg",name+".pending-"+id);
                        if(temporary==null)throw new java.io.IOException("Could not create archive image");
                        try(OutputStream out=context.getContentResolver().openOutputStream(temporary,"wt")) {if(out==null)throw new java.io.IOException("Archive folder is not writable");out.write(bytes);out.flush();}
                        if(!matches(context.getContentResolver(),temporary,hash))throw new java.io.IOException("External photo verification failed; private snapshot retained");
                        document=DocumentsContract.renameDocument(context.getContentResolver(),temporary,name);
                        if(document==null)throw new java.io.IOException("Could not finalize archive image; private snapshot retained");
                    }
                    if(!matches(context.getContentResolver(),document,hash))throw new java.io.IOException("Existing external photo differs; private snapshot retained");
                    update.put("status","mirrored");update.put("last_error","");update.put("document_uri",document.toString());
                    archive.getWritableDatabase().update("photos",update,"id=? AND rep_id=?",new String[]{id,String.valueOf(owner)});
                    snapshot.delete();
                } catch(Exception error) {
                    update.clear();update.put("last_error","تعذر نسخ الصورة إلى المجلد المختار؛ النسخة الأصلية محفوظة. أعد اختيار المجلد إذا أُلغي الإذن.");
                    archive.getWritableDatabase().update("photos",update,"id=? AND rep_id=?",new String[]{id,String.valueOf(owner)});
                }
            }
        }
    }
    static synchronized String saveRecoveryExport(Context context,long owner,String json,String filename) throws Exception {
        Uri tree=tree(context,owner);if(tree==null)throw new SecurityException("اختر مجلداً محلياً لحفظ نسخة الاسترداد.");
        if(owner!=RepAuthStore.repId(context))throw new SecurityException("تغير حساب المندوب.");
        Uri root=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        Uri parent=directory(context.getContentResolver(),tree,root,"RecoveryExports");
        Uri target=DocumentsContract.createDocument(context.getContentResolver(),parent,"application/json",filename);
        if(target==null)throw new java.io.IOException("تعذر إنشاء نسخة الاسترداد.");
        byte[] bytes=json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        try(OutputStream output=context.getContentResolver().openOutputStream(target,"wt")) {if(output==null)throw new java.io.IOException("مجلد الاسترداد غير قابل للكتابة.");output.write(bytes);output.flush();}
        java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
        try(InputStream input=context.getContentResolver().openInputStream(target)) {
            if(input==null)throw new java.io.IOException("تعذرت مراجعة الملف المحفوظ.");byte[] buffer=new byte[8192];int count;long total=0;
            while((count=input.read(buffer))!=-1) {total+=count;if(total>bytes.length)throw new java.io.IOException("حجم نسخة الاسترداد غير مطابق.");digest.update(buffer,0,count);}
            if(total!=bytes.length||!java.util.Arrays.equals(digest.digest(),java.security.MessageDigest.getInstance("SHA-256").digest(bytes)))throw new java.io.IOException("فشل التحقق من نسخة الاسترداد المحفوظة.");
        }
        return target.toString();
    }

    private static Uri find(ContentResolver resolver,Uri tree,Uri parent,String name) throws Exception {
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));
        try(Cursor rows=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
            if(rows!=null)while(rows.moveToNext())if(name.equals(rows.getString(1)))return DocumentsContract.buildDocumentUriUsingTree(tree,rows.getString(0));
        }
        return null;
    }
    private static Uri directory(ContentResolver resolver,Uri tree,Uri parent,String name) throws Exception {
        if(name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/"))throw new SecurityException("Invalid archive directory");
        Uri existing=find(resolver,tree,parent,name);
        if(existing!=null)return existing;
        Uri created=DocumentsContract.createDocument(resolver,parent,DocumentsContract.Document.MIME_TYPE_DIR,name);
        if(created==null)throw new java.io.IOException("Could not create archive directory");return created;
    }
    private static boolean matches(ContentResolver resolver,Uri uri,String hash) throws Exception {
        try(InputStream input=resolver.openInputStream(uri);java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()) {
            if(input==null)return false;byte[] buffer=new byte[8192];int count;
            while((count=input.read(buffer))!=-1) {if(bytes.size()+count>3*1024*1024)throw new java.io.IOException("Oversized external image");bytes.write(buffer,0,count);}
            return RepRecoveryValidator.hash(bytes.toByteArray()).equals(hash);
        }
    }
}
