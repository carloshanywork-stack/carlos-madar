package com.madar.rep.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Authenticated foreground SSE. No background push provider or background service. */
final class RepRealtimeConnection {
    private final Context context;
    private final Consumer<JSObject> events;
    private final Consumer<JSObject> status;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile boolean active;
    private volatile Call call;
    private int failures;
    private volatile int generation;
    private final OkHttpClient client = new OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS)
        .readTimeout(60,TimeUnit.SECONDS).build();
    RepRealtimeConnection(Context context,Consumer<JSObject> events,Consumer<JSObject> status) {
        this.context=context.getApplicationContext();this.events=events;this.status=status;
    }
    synchronized void start() { if(active)return;active=true;connect(++generation); }
    synchronized void stop() {active=false;generation++;handler.removeCallbacksAndMessages(null);if(call!=null)call.cancel();}
    void destroy() {stop();io.shutdownNow();}
    private void connect(int version) {if(!active || version!=generation)return;io.execute(()->read(version));}
    private void read(int version) {
        if(!active || version!=generation)return;
        long owner=RepAuthStore.repId(context);String token=RepAuthStore.token(context);
        if(owner<1 || token==null) {active=false;status.accept(new JSObject().put("state","authentication_required"));return;}
        android.content.SharedPreferences prefs=context.getSharedPreferences("madar_rep_realtime",Context.MODE_PRIVATE);
        long cursor=prefs.getLong("cursor:"+owner,0L);
        Request request=new Request.Builder().url(BuildConfig.REP_SERVER_URL.replaceAll("/+$","")+"/api/rep/events?lastEventId="+cursor)
            .header("Authorization","Bearer "+token).header("Accept","text/event-stream").header("Last-Event-ID",String.valueOf(cursor)).build();
        Call current=client.newCall(request);call=current;
        try(Response response=current.execute()) {
            if(response.code()==401 || response.code()==403) {active=false;status.accept(new JSObject().put("state","authentication_required"));return;}
            if(!response.isSuccessful() || response.body()==null)throw new java.io.IOException("Event connection unavailable");
            failures=0;status.accept(new JSObject().put("state","connected").put("reconcile",true));
            StringBuilder data=new StringBuilder();String line;
            while(active && version==generation && owner==RepAuthStore.repId(context) && token.equals(RepAuthStore.token(context)) && (line=response.body().source().readUtf8Line())!=null) {
                if(line.length()>1024*1024)throw new java.io.IOException("Oversized event frame");
                if(line.startsWith("data:")) {if(data.length()>0)data.append('\n');data.append(line.substring(5).trim());}
                if(data.length()>1024*1024)throw new java.io.IOException("Oversized event frame");
                if(line.isEmpty() && data.length()>0) {
                    JSObject event=new JSObject(data.toString());data.setLength(0);
                    if(event.optBoolean("cursorReset",false)) {cursor=0;prefs.edit().putLong("cursor:"+owner,0L).apply();}
                    long id=event.optLong("id",0L);
                    if(id>0 && id<=cursor)continue;
                    if(owner!=RepAuthStore.repId(context)||!token.equals(RepAuthStore.token(context))||version!=generation)break;
                    events.accept(event);
                    if(id>0) {cursor=id;prefs.edit().putLong("cursor:"+owner,cursor).apply();}
                }
            }
        } catch(Exception error) {if(active)status.accept(new JSObject().put("state","reconnecting").put("reconcile",true));}
        finally {if(call==current)call=null;}
        if(active && version==generation && owner==RepAuthStore.repId(context)) {
            long delay=Math.min(30000L,1000L << Math.min(++failures,5));
            handler.postDelayed(()->connect(version),delay);
        }
    }
}
