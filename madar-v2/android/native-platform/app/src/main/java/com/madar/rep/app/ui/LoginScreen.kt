package com.madar.rep.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarTeal

@Composable
fun LoginScreen(
    state: LoginUiState,
    defaultServerUrl: String,
    onLogin: (serverUrl: String, username: String, password: String) -> Unit,
    onClearError: () -> Unit,
) {
    var serverUrl by rememberSaveable { mutableStateOf(defaultServerUrl) }
    var username by rememberSaveable { mutableStateOf("") }
    // Passwords must never enter saved-instance state or a restoration bundle.
    var password by remember { mutableStateOf("") }
    var passwordVisible by rememberSaveable { mutableStateOf(false) }
    var advanced by rememberSaveable { mutableStateOf(false) }

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
                        "تسجيل الدخول",
                        style = MaterialTheme.typography.titleLarge,
                        color = MadarInk,
                    )
                    Text(
                        "استخدم حساب المندوب المعتمد. الجلسة مشفّرة على الجهاز.",
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

                    if (advanced) {
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = {
                                serverUrl = it
                                onClearError()
                            },
                            label = { Text("عنوان السيرفر") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                imeAction = ImeAction.Next,
                            ),
                            supportingText = {
                                Text(
                                    if (BuildConfig.DEBUG) "يفضّل HTTPS. HTTP مسموح فقط لعنوان محلي أثناء التطوير."
                                    else "يجب أن يبدأ بـ https://"
                                )
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (state.error != null) {
                        InlineMessage(state.error, MessageTone.Error)
                    }

                    Button(
                        onClick = {
                            val submittedPassword = password
                            password = ""
                            onLogin(serverUrl.trim(), username.trim(), submittedPassword)
                        },
                        enabled = !state.busy && username.isNotBlank() && password.isNotEmpty() && serverUrl.isNotBlank(),
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
                            Text("دخول", fontWeight = FontWeight.Bold)
                        }
                    }

                    androidx.compose.material3.TextButton(
                        onClick = { advanced = !advanced },
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    ) {
                        Text(if (advanced) "إخفاء إعدادات السيرفر" else "إعدادات السيرفر المتقدمة")
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
}
