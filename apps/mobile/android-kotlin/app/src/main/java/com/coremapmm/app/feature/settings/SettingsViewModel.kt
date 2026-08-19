package com.coremapmm.app.feature.settings

import androidx.lifecycle.ViewModel
import com.coremapmm.app.core.fake.FakeOfflinePackages
import com.coremapmm.app.core.fake.FakeSettingsData
import com.coremapmm.app.core.fake.FakeUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class SettingsViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(buildInitialState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    fun openService(service: SettingsService) {
        _uiState.update { it.copy(activeService = service) }
    }

    fun closeService() {
        _uiState.update { it.copy(activeService = null) }
    }

    fun toggleDataSaver(enabled: Boolean) {
        _uiState.update { it.copy(dataSaverEnabled = enabled) }
    }

    fun selectOfflineArea(area: OfflineAreaOption) {
        updateOfflineSelection(area = area)
    }

    fun selectOfflinePackage(packageOption: OfflinePackageOption) {
        updateOfflineSelection(packageOption = packageOption)
    }

    fun selectReportFilter(filter: ReportStatusFilter) {
        _uiState.update { it.copy(selectedReportFilter = filter) }
    }

    fun toggleGuestUser() {
        _uiState.update { state ->
            val nextUser = if (state.user.isGuest) FakeUser.signedInUser else FakeUser.guestUser
            state.copy(user = nextUser)
        }
    }

    private fun updateOfflineSelection(
        area: OfflineAreaOption? = null,
        packageOption: OfflinePackageOption? = null,
    ) {
        _uiState.update { state ->
            val nextArea = area ?: state.selectedOfflineArea
            val nextPackage = packageOption ?: state.selectedOfflinePackage
            state.copy(
                selectedOfflineArea = nextArea,
                selectedOfflinePackage = nextPackage,
                estimatedPackageLabel = FakeSettingsData.packageSummaryLabel(nextArea, nextPackage),
                offlineWarnings = FakeSettingsData.offlineWarnings(nextArea, nextPackage),
            )
        }
    }

    private fun buildInitialState(): SettingsUiState {
        val area = OfflineAreaOption.CurrentTownship
        val packageOption = OfflinePackageOption.Lite
        return SettingsUiState(
            user = FakeUser.currentUser,
            services = FakeSettingsData.services,
            dataSaverEnabled = true,
            selectedOfflineArea = area,
            selectedOfflinePackage = packageOption,
            estimatedPackageLabel = FakeSettingsData.packageSummaryLabel(area, packageOption),
            downloadedAreas = FakeOfflinePackages.packages.filter {
                it.status == com.coremapmm.app.core.model.OfflinePackageStatus.Downloaded ||
                    it.status == com.coremapmm.app.core.model.OfflinePackageStatus.UpdateAvailable ||
                    it.status == com.coremapmm.app.core.model.OfflinePackageStatus.Downloading
            },
            offlineWarnings = FakeSettingsData.offlineWarnings(area, packageOption),
            reports = FakeSettingsData.reports,
            contributions = FakeSettingsData.contributions,
            adminRewardText = FakeSettingsData.adminRewardText,
        )
    }
}
