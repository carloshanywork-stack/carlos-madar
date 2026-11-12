package com.madar.rep.app;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.function.LongConsumer;
/** Process-local UI hint only; SQLite remains authoritative across restarts. */
final class RepQueueSignals {
    private static final Set<LongConsumer> listeners=new CopyOnWriteArraySet<>();
    static void add(LongConsumer listener){listeners.add(listener);}
    static void remove(LongConsumer listener){listeners.remove(listener);}
    static void emit(long owner){for(LongConsumer listener:listeners)try{listener.accept(owner);}catch(Exception ignored){}}
}
