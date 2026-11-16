# General Android and line number preservation
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*
-keepattributes JavascriptInterface

# Keep Capacitor Core and Plugin reflections
-keep public class com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.ActivityCallback public *;
    @com.getcapacitor.annotation.PermissionCallback public *;
}
-keep class com.getcapacitor.annotation.* { *; }
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.BridgeActivity { *; }

# Keep Cordova plugins
-keep class org.apache.cordova.** { *; }

# Keep MADAR plugins, SQLite local stores, and background workers
-keep class com.madar.rep.app.** { *; }
-keepclassmembers class com.madar.rep.app.** { *; }

# Keep WorkManager workers
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Keep AndroidX Biometric and Security Crypto
-keep class androidx.biometric.** { *; }
-keep class androidx.security.crypto.** { *; }

# Keep WebKit and Javascript interfaces
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
