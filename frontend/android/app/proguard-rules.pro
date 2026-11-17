# Proguard configuration for Capacitor and School Store

# Capacitor core and plugins
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    public <methods>;
}

# WebKit & JavaScript interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Cordova plugins
-keep class org.apache.cordova.** { *; }
-keep class com.apache.cordova.** { *; }

# Attributes and metadata
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Preserve AndroidX and Play Services
-keep class androidx.** { *; }
-keep interface androidx.** { *; }
-dontwarn androidx.**

# Keep BuildConfig
-keep class com.colorbenz.schoolstore.BuildConfig { *; }
