# MADAR native release rules. Keep room-generated and serialization metadata.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.madar.rep.app.**$$serializer { *; }
-keepclassmembers class com.madar.rep.app.** { *** Companion; }
