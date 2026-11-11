package com.madar.rep.app;

import android.content.Context;
import android.app.KeyguardManager;
import android.os.Build;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

/** Local OS biometric prompt. No biometric template or credential leaves Android. */
final class RepBiometricAuth {
    static final int ALLOWED_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG
        | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    private static final int BIOMETRIC_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK;

    interface Callback {
        void onSuccess(int authenticationType);
        void onError(int errorCode);
    }

    private RepBiometricAuth() { }

    static int availability(Context context) {
        int biometricStatus = BiometricManager.from(context).canAuthenticate(BIOMETRIC_AUTHENTICATORS);
        if (biometricStatus == BiometricManager.BIOMETRIC_SUCCESS) return biometricStatus;
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return keyguard != null && keyguard.isDeviceSecure()
            ? BiometricManager.BIOMETRIC_SUCCESS
            : biometricStatus;
    }

    static boolean isAvailable(Context context) {
        return availability(context) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    static BiometricPrompt authenticate(FragmentActivity activity, String title, Callback callback) {
        boolean biometricReady = BiometricManager.from(activity).canAuthenticate(BIOMETRIC_AUTHENTICATORS)
            == BiometricManager.BIOMETRIC_SUCCESS;
        BiometricPrompt prompt = new BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    callback.onSuccess(result.getAuthenticationType());
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errorString) {
                    callback.onError(errorCode);
                }
            }
        );
        BiometricPrompt.PromptInfo.Builder promptInfoBuilder = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("تأكيد هوية المندوب على هذا الهاتف")
            .setDescription("تُستخدم نتيجة التحقق لتسجيل الحضور فقط؛ لا تُرسل بيانات البصمة إلى MADAR.");
        if (biometricReady) {
            promptInfoBuilder
                .setAllowedAuthenticators(BIOMETRIC_AUTHENTICATORS)
                .setNegativeButtonText("إلغاء");
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            promptInfoBuilder.setAllowedAuthenticators(BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else {
            // On Android 10 and below, AndroidX exposes the OS PIN/pattern/password fallback here.
            promptInfoBuilder.setDeviceCredentialAllowed(true);
        }
        BiometricPrompt.PromptInfo promptInfo = promptInfoBuilder.build();
        prompt.authenticate(promptInfo);
        return prompt;
    }
}
