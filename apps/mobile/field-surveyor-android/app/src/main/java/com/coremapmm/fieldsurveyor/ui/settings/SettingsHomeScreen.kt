package com.coremapmm.fieldsurveyor.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.ui.components.ScreenHeader

@Composable
fun SettingsHomeScreen(
    language: FieldLanguage,
    themeMode: FieldThemeMode,
    onLanguage: (FieldLanguage) -> Unit,
    onThemeMode: (FieldThemeMode) -> Unit,
    onProfile: () -> Unit,
    onOutbox: () -> Unit,
    onInfra: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScreenHeader(tr("Settings"), tr("Account, captured work, and offline data."))
        ChoiceCard(tr("Language")) {
            ChoiceButton(tr("Myanmar"), language == FieldLanguage.MYANMAR, Modifier.weight(1f)) {
                onLanguage(FieldLanguage.MYANMAR)
            }
            ChoiceButton(tr("English"), language == FieldLanguage.ENGLISH, Modifier.weight(1f)) {
                onLanguage(FieldLanguage.ENGLISH)
            }
        }
        ChoiceCard(tr("Appearance")) {
            ChoiceButton(tr("Light"), themeMode == FieldThemeMode.LIGHT, Modifier.weight(1f)) {
                onThemeMode(FieldThemeMode.LIGHT)
            }
            ChoiceButton(tr("Dark"), themeMode == FieldThemeMode.DARK, Modifier.weight(1f)) {
                onThemeMode(FieldThemeMode.DARK)
            }
        }
        SettingsRow(tr("Profile"), tr("Signed-in surveyor account"), onProfile)
        SettingsRow(tr("Outbox"), tr("Captured, synced, and waiting reports"), onOutbox)
        SettingsRow(tr("Infra"), tr("Yangon PMTiles and YBS snapshot sync"), onInfra)
    }
}

@Composable
fun SettingsPage(
    title: String,
    onBack: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        TextButton(onClick = onBack, modifier = Modifier.padding(horizontal = 8.dp)) {
            Text(tr("Back"))
        }
        Text(
            title,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        content()
    }
}

@Composable
private fun ChoiceCard(title: String, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)
        }
    }
}

@Composable
private fun ChoiceButton(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        colors = if (selected) ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ) else ButtonDefaults.outlinedButtonColors(),
    ) { Text(label) }
}

@Composable
private fun SettingsRow(title: String, subtitle: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
