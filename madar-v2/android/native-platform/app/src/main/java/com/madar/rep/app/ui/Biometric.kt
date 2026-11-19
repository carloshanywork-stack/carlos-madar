package com.madar.rep.app.ui

import android.app.KeyguardManager
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Biometric & Device Credential (PIN / Pattern / Password) gate used before a clock-in/out action.
 * Allows authentication via fingerprint, face, or the device screen lock credential (phone password).
 */
@Composable
fun rememberBiometricGate(onResult: (Boolean, String?) -> Unit): (String, String) -> Unit {
    val context = LocalContext.current
    val activity = remember(context) { context.findFragmentActivity() }
    val callback = rememberUpdatedState(onResult).value
    return remember(activity) {
        { title, subtitle ->
            if (activity == null) {
                callback(false, "تعذر فتح نافذة المصادقة على هذا الجهاز.")
            } else {
                val keyguardManager = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                val isDeviceSecure = keyguardManager?.isDeviceSecure == true
                val manager = BiometricManager.from(activity)

                val canAuthWithCreds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.DEVICE_CREDENTIAL
                    val status = manager.canAuthenticate(authenticators)
                    status == BiometricManager.BIOMETRIC_SUCCESS || isDeviceSecure
                } else {
                    manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS || isDeviceSecure
                }

                if (!canAuthWithCreds) {
                    callback(
                        false,
                        "يلزم تفعيل بصمة أو تعيين قفل للشاشة (رمز PIN أو كلمة مرور) على الهاتف لتسجيل الحضور."
                    )
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
                                if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                                    errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                                    errorCode == BiometricPrompt.ERROR_CANCELED
                                ) {
                                    callback(false, null)
                                } else {
                                    callback(false, errString.toString())
                                }
                            }

                            override fun onAuthenticationFailed() {
                                // The prompt stays open; the user can retry fingerprint or use screen lock.
                            }
                        },
                    )

                    val promptInfoBuilder = BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        promptInfoBuilder.setAllowedAuthenticators(
                            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                                BiometricManager.Authenticators.DEVICE_CREDENTIAL
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        promptInfoBuilder.setDeviceCredentialAllowed(true)
                    }

                    try {
                        val info = promptInfoBuilder.build()
                        prompt.authenticate(info)
                    } catch (e: Exception) {
                        callback(false, "تعذر بدء المصادقة: ${e.message}")
                    }
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
