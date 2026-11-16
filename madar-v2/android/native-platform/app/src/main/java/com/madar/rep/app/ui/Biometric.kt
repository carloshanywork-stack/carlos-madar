package com.madar.rep.app.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Real BiometricPrompt gate used before a clock-in/out action. There is no
 * software bypass: if the device has no enrolled biometric the action is refused
 * and no attendance row is queued.
 */
@Composable
fun rememberBiometricGate(onResult: (Boolean, String?) -> Unit): (String, String) -> Unit {
    val context = LocalContext.current
    val activity = remember(context) { context.findFragmentActivity() }
    val callback = rememberUpdatedState(onResult).value
    return remember(activity) {
        { title, subtitle ->
            if (activity == null) {
                callback(false, "تعذر فتح المصادقة الحيوية على هذا الجهاز.")
            } else {
                val manager = BiometricManager.from(activity)
                val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
                val status = manager.canAuthenticate(authenticators)
                if (status != BiometricManager.BIOMETRIC_SUCCESS) {
                    val message = when (status) {
                        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "لا يوجد مستشعر بصمة على هذا الجهاز."
                        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "مستشعر البصمة غير متاح حاليًا."
                        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "لا توجد بصمة مسجلة على الجهاز. أضف بصمة من إعدادات النظام."
                        else -> "المصادقة الحيوية غير متاحة على هذا الجهاز."
                    }
                    callback(false, message)
                } else {
                    val executor = ContextCompat.getMainExecutor(activity)
                    val prompt = BiometricPrompt(
                        activity,
                        executor,
                        object : BiometricPrompt.AuthenticationCallback() {
                            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                                callback(true, null)
                            }

                            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                                callback(false, errString.toString())
                            }

                            override fun onAuthenticationFailed() {
                                // The prompt stays open; the user can retry the fingerprint.
                            }
                        },
                    )
                    val info = BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(authenticators)
                        .setNegativeButtonText("إلغاء")
                        .build()
                    prompt.authenticate(info)
                }
            }
        }
    }
}

private tailrec fun Context.findFragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> null
}
