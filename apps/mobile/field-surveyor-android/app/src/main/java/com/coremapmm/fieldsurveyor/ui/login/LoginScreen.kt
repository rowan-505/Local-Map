package com.coremapmm.fieldsurveyor.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.auth.AuthRepository
import com.coremapmm.fieldsurveyor.ui.components.FieldCard
import com.coremapmm.fieldsurveyor.ui.components.ScreenHeader
import com.coremapmm.fieldsurveyor.ui.settings.tr
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    auth: AuthRepository,
    apiBaseUrl: String,
    onLoggedIn: () -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 40.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        ScreenHeader(
            title = tr("CoreMap Field"),
            subtitle = tr("Reliable field capture for Myanmar transport data."),
        )
        FieldCard {
            Text(tr("Surveyor sign in"), style = MaterialTheme.typography.titleLarge)
            Text(
                tr("Your session is encrypted with Android Keystore."),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text(tr("Email")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(tr("Password")) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) {
                Text(tr(error!!), color = MaterialTheme.colorScheme.error)
            }
            Button(
                onClick = {
                    error = null
                    busy = true
                    scope.launch {
                        try {
                            auth.login(email.trim(), password)
                            onLoggedIn()
                        } catch (ex: AuthException) {
                            error = ex.message
                        } catch (ex: Exception) {
                            error = ex.message ?: "Login failed"
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && email.isNotBlank() && password.length >= 6,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(tr(if (busy) "Signing in…" else "Sign in"))
            }
        }
        Text(
            tr("Connected to $apiBaseUrl"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (isEmulatorOnlyApiUrl(apiBaseUrl)) {
            Text(
                tr("Emulator address detected. A physical phone needs the Mac LAN address in local.properties."),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

private fun isEmulatorOnlyApiUrl(url: String): Boolean {
    val lower = url.lowercase()
    return lower.contains("10.0.2.2") ||
        lower.contains("127.0.0.1") ||
        lower.contains("localhost")
}
