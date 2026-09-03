package com.coremapmm.fieldsurveyor.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.coremapmm.fieldsurveyor.auth.AuthRepository
import com.coremapmm.fieldsurveyor.ui.components.FieldCard
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import kotlinx.coroutines.launch

@Composable
fun ProfileScreen(
    auth: AuthRepository,
    apiBaseUrl: String,
    onLoggedOut: () -> Unit,
) {
    val session by auth.session.collectAsStateWithLifecycle()
    val user = session?.user
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (user == null) {
            Text(tr("Not signed in."))
        } else {
            FieldCard {
                StatusPill(tr("Active session"), positive = true)
                Text(user.displayName.ifBlank { user.email }, style = MaterialTheme.typography.titleLarge)
                Text(user.email, style = MaterialTheme.typography.bodyMedium)
                Text(tr("Roles · ${user.roles.joinToString()}"), style = MaterialTheme.typography.bodySmall)
            }
            FieldCard {
                Text(tr("Connection"), style = MaterialTheme.typography.titleMedium)
                Text(apiBaseUrl, style = MaterialTheme.typography.bodySmall)
                Text(
                    tr("Logging out removes credentials only. Waiting reports and offline maps remain safely on this device."),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedButton(
                onClick = {
                    scope.launch {
                        try {
                            auth.logout()
                        } catch (_: Exception) {
                            auth.clearCredentialsOnly()
                        }
                        onLoggedOut()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(tr("Log out"))
            }
        }
    }
}
