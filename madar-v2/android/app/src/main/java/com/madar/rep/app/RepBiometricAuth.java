package com.madar.rep.app;

import android.content.Context;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

/** Local OS biometric prompt. No biometric template or credential leaves Android. */
final class RepBiometricAuth {
    static final int ALLOWED_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG
        | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    interface Callback {
        void onSuccess(int authenticationType);
        void onError(int errorCode);
    }

    private RepBiometricAuth() { }

    static int availability(Context context) {
        return BiometricManager.from(context).canAuthenticate(ALLOWED_AUTHENTICATORS);
    }

    static boolean isAvailable(Context context) {
        return availability(context) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    static BiometricPrompt authenticate(FragmentActivity activity, String title, Callback callback) {
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
        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("تأكيد هوية المندوب على هذا الهاتف")
            .setDescription("تُستخدم نتيجة التحقق لتسجيل الحضور فقط؛ لا تُرسل بيانات البصمة إلى MADAR.")
            .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
            .setNegativeButtonText("إلغاء")
            .build();
        prompt.authenticate(promptInfo);
        return prompt;
    }
}
