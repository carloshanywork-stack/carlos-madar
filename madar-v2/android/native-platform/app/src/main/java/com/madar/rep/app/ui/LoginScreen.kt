package com.madar.rep.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.R
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarTeal

@Composable
fun LoginScreen(
    state: LoginUiState,
    onLogin: (username: String, password: String) -> Unit,
    onUnlockOffline: () -> Unit = {},
    onClearError: () -> Unit = {},
    onRemoveAccount: () -> Unit = {},
) {
    val enrolled = state.enrolledIdentity
    var showPasswordForm by rememberSaveable { mutableStateOf(enrolled == null) }
    var confirmRemoveAccount by rememberSaveable { mutableStateOf(false) }

    var username by rememberSaveable(enrolled) { mutableStateOf(enrolled?.username ?: "") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by rememberSaveable { mutableStateOf(false) }

    val biometricGate = rememberBiometricGate { success, _ ->
        if (success) {
            onUnlockOffline()
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(MadarInk, Color(0xFF1E3A50), MadarInk)
                )
            )
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painterResource(R.drawable.ic_madar_mark),
                contentDescription = "شعار مدار",
                modifier = Modifier.size(88.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "مَـدَار",
                color = Color.White,
                fontSize = 40.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 4.sp,
            )
            Text(
                "تطبيق مندوب الصيانة الميداني",
                color = Color.White.copy(alpha = 0.78f),
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(28.dp))

            if (enrolled != null && !showPasswordForm) {
                // Enrolled Account Card for Offline Unlock
                Card(
                    shape = RoundedCornerShape(24.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            Icons.Default.AccountCircle,
                            contentDescription = null,
                            tint = MadarTeal,
                            modifier = Modifier.size(60.dp),
                        )
                        Text(
                            enrolled.fullName?.takeIf(String::isNotBlank) ?: enrolled.username,
                            style = MaterialTheme.typography.titleLarge,
                            color = MadarInk,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "@${enrolled.username}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF5A6B7C),
                        )

                        if (enrolled.isOfflineLeaseValid()) {
                            Surface(
                                shape = RoundedCornerShape(50),
                                color = Color(0xFFE8F5E9),
                            ) {
                                Text(
                                    "صلاحية العمل دون اتصال: باقي ${enrolled.remainingDays} يوم",
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                                    color = Color(0xFF2E7D32),
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        } else {
                            Surface(
                                shape = RoundedCornerShape(50),
                                color = Color(0xFFFFEBEE),
                            ) {
                                Text(
                                    "انتهت صلاحية العمل دون اتصال. يلزم إدخال كلمة المرور.",
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                                    color = Color(0xFFC62828),
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                        }

                        if (state.error != null) {
                            InlineMessage(state.error, MessageTone.Error)
                        }

                        if (enrolled.isOfflineLeaseValid()) {
                            Button(
                                onClick = {
                                    biometricGate("فتح تطبيق مدار", "استخدم بصمة الإصبع أو رمز قفل الشاشة للعمل دون اتصال")
                                },
                                enabled = !state.busy,
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                                shape = RoundedCornerShape(14.dp),
                            ) {
                                if (state.busy) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(20.dp),
                                        strokeWidth = 2.dp,
                                        color = Color.White,
                                    )
                                    Spacer(Modifier.size(10.dp))
                                    Text("جارٍ الفتح…")
                                } else {
                                    Icon(Icons.Default.Fingerprint, contentDescription = null)
                                    Spacer(Modifier.size(8.dp))
                                    Text("فتح بالبصمة أو رمز الهاتف", fontWeight = FontWeight.Bold)
                                }
                            }
                        }

                        TextButton(
                            onClick = {
                                showPasswordForm = true
                                onClearError()
                            }
                        ) {
                            Text("تسجيل الدخول بكلمة المرور / حساب آخر", color = MadarTeal)
                        }
                    }
                }
            } else {
                // Online Login / Enrollment Form
                Card(
                    shape = RoundedCornerShape(24.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text(
                            if (enrolled != null) "تجديد الاتصال بالخادم" else "تسجيل الدخول",
                            style = MaterialTheme.typography.titleLarge,
                            color = MadarInk,
                        )
                        Text(
                            if (enrolled != null) "أدخل كلمة المرور لتجديد الجلسة والمزامنة مع الخادم."
                            else "استخدم حساب المندوب المعتمد. الجلسة مشفّرة على الجهاز.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF5A6B7C),
                        )

                        OutlinedTextField(
                            value = username,
                            onValueChange = {
                                username = it
                                onClearError()
                            },
                            label = { Text("اسم المستخدم") },
                            singleLine = true,
                            leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Text,
                                imeAction = ImeAction.Next,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = {
                                password = it
                                onClearError()
                            },
                            label = { Text("كلمة المرور") },
                            singleLine = true,
                            leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                            trailingIcon = {
                                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                    Icon(
                                        if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                        contentDescription = if (passwordVisible) "إخفاء" else "إظهار",
                                    )
                                }
                            },
                            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )

                        if (state.error != null) {
                            InlineMessage(state.error, MessageTone.Error)
                        }

                        Button(
                            onClick = {
                                val submittedPassword = password
                                password = ""
                                onLogin(username.trim(), submittedPassword)
                            },
                            enabled = !state.busy && username.isNotBlank() && password.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            if (state.busy) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = Color.White,
                                )
                                Spacer(Modifier.size(10.dp))
                                Text("جارٍ تسجيل الدخول…")
                            } else {
                                Text("دخول ومزامنة", fontWeight = FontWeight.Bold)
                            }
                        }

                        if (enrolled != null && enrolled.isOfflineLeaseValid()) {
                            OutlinedButton(
                                onClick = {
                                    showPasswordForm = false
                                    onClearError()
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.Fingerprint, contentDescription = null)
                                Spacer(Modifier.size(8.dp))
                                Text("العودة للفتح بالبصمة (دون اتصال)")
                            }
                        }

                        if (enrolled != null) {
                            TextButton(
                                onClick = { confirmRemoveAccount = true },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("إزالة هذا الحساب من الهاتف", color = MadarDanger)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            Text(
                "الإصدار ${BuildConfig.VERSION_NAME} · ${BuildConfig.VERSION_CODE}",
                color = Color.White.copy(alpha = 0.6f),
                fontSize = 12.sp,
            )
            Box(
                Modifier
                    .padding(top = 10.dp)
                    .size(width = 42.dp, height = 3.dp)
                    .background(MadarGold, RoundedCornerShape(50))
            )
        }
    }

    if (confirmRemoveAccount) {
        AlertDialog(
            onDismissRequest = { confirmRemoveAccount = false },
            title = { Text("إزالة الحساب من الجهاز؟") },
            text = {
                Text(
                    "هل أنت متأكد من إزالة الحساب من هذا الهاتف؟ ستحتاج إلى الاتصال بالإنترنت لإعادة تسجيل الدخول."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmRemoveAccount = false
                        showPasswordForm = true
                        onRemoveAccount()
                    }
                ) { Text("إزالة", color = MadarDanger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmRemoveAccount = false }) { Text("إلغاء") }
            },
        )
    }
}
