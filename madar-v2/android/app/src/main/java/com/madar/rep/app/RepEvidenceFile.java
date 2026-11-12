package com.madar.rep.app;

import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;

/** Preserve the last complete image on write/sync/rename failure. Serializes writers in this process. */
final class RepEvidenceFile {
    static byte[] read(File file) throws java.io.IOException {
        try(java.io.FileInputStream in=new AtomicFile(file).openRead();java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);return out.toByteArray();
        }
    }
    static synchronized void write(File target, byte[] bytes) throws Exception {
        AtomicFile file = new AtomicFile(target);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(bytes);
            output.getFD().sync();
            file.finishWrite(output);
            try (java.io.FileInputStream committed=file.openRead()) {
                byte[] saved=read(target);
                if(!java.util.Arrays.equals(saved,bytes))throw new java.io.IOException("Atomic image commit was not verified; previous image retained");
            }
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }
}
