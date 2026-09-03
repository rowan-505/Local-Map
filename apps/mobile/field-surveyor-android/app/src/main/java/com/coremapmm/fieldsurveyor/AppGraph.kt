package com.coremapmm.fieldsurveyor

import com.coremapmm.fieldsurveyor.auth.AuthApi
import com.coremapmm.fieldsurveyor.auth.AuthRepository
import com.coremapmm.fieldsurveyor.auth.SecureTokenStore
import com.coremapmm.fieldsurveyor.data.FieldDatabase
import com.coremapmm.fieldsurveyor.data.FieldMediaApi
import com.coremapmm.fieldsurveyor.data.FieldReportsApi
import com.coremapmm.fieldsurveyor.data.LocalReportDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.data.transport.FieldBootstrapApi
import com.coremapmm.fieldsurveyor.media.ReportPhotoStore
import com.coremapmm.fieldsurveyor.media.ReportVoiceStore
import com.coremapmm.fieldsurveyor.net.FieldHttp
import com.coremapmm.fieldsurveyor.offline.YangonBasemapStore
import com.coremapmm.fieldsurveyor.survey.GpsEngine
import com.coremapmm.fieldsurveyor.survey.SurveyController
import com.coremapmm.fieldsurveyor.survey.SurveySelectionStore
import com.coremapmm.fieldsurveyor.work.FieldWork

/** Manual composition root. Not a DI framework. */
class AppGraph(
    val auth: AuthRepository,
    val database: FieldDatabase,
    val reports: LocalReportDao,
    val reportMedia: LocalReportMediaDao,
    val photos: ReportPhotoStore,
    val voice: ReportVoiceStore,
    val bootstrap: BootstrapRepository,
    val survey: SurveyController,
    val fieldReportsApi: FieldReportsApi,
    val fieldMediaApi: FieldMediaApi,
    val yangon: YangonBasemapStore,
    val apiBaseUrl: String,
) {
    companion object {
        fun create(app: FieldApp): AppGraph {
            val http = FieldHttp.client()
            val database = FieldDatabase.create(app)
            val auth = AuthRepository(
                api = AuthApi(BuildConfig.API_BASE_URL, http),
                tokenStore = SecureTokenStore(app),
            )
            val reports = database.localReportDao()
            val reportMedia = database.localReportMediaDao()
            val photos = ReportPhotoStore(
                mediaDir = ReportPhotoStore.dir(app.noBackupFilesDir),
                dao = reportMedia,
            )
            val voice = ReportVoiceStore(
                mediaDir = ReportPhotoStore.dir(app.noBackupFilesDir),
                dao = reportMedia,
            )
            val bootstrap = BootstrapRepository(
                auth = auth,
                api = FieldBootstrapApi(BuildConfig.API_BASE_URL, http),
                cache = database.transportCacheDao(),
            )
            val fieldReportsApi = FieldReportsApi(BuildConfig.API_BASE_URL, http)
            val fieldMediaApi = FieldMediaApi(BuildConfig.API_BASE_URL, http)
            val yangon = YangonBasemapStore(
                context = app,
                downloadUrl = BuildConfig.YANGON_PMTILES_URL,
                http = FieldHttp.downloadClient(),
            )
            return AppGraph(
                auth = auth,
                database = database,
                reports = reports,
                reportMedia = reportMedia,
                photos = photos,
                voice = voice,
                bootstrap = bootstrap,
                survey = SurveyController(
                    selectionStore = SurveySelectionStore(app),
                    bootstrap = bootstrap,
                    reports = reports,
                    photos = photos,
                    voice = voice,
                    gpsEngine = GpsEngine(app),
                    onCaptured = { FieldWork.enqueue(app) },
                ),
                fieldReportsApi = fieldReportsApi,
                fieldMediaApi = fieldMediaApi,
                yangon = yangon,
                apiBaseUrl = BuildConfig.API_BASE_URL,
            )
        }
    }
}
