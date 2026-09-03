package com.coremapmm.fieldsurveyor.survey

enum class RouteIssueKind {
    PATH_WRONG,
    MISSING_SEGMENT,
    OTHER,
}

object SurveyReportFlow {
    fun saveError(
        running: Boolean,
        kind: AnomalyKind,
        hasStop: Boolean,
        mapPick: GpsFix?,
        note: String,
        routeIssue: RouteIssueKind?,
    ): String? {
        if (!running) {
            return "Start Survey first. That keeps GPS on and the screen awake."
        }
        return when (kind) {
            AnomalyKind.MOVED -> when {
                !hasStop -> "Select the stop that moved."
                mapPick == null -> "Tap the map where the stop really is."
                else -> null
            }
            AnomalyKind.MISSING -> if (hasStop) null else "Select the missing stop."
            AnomalyKind.DATA -> when {
                !hasStop -> "Select the stop with wrong data."
                note.isBlank() -> "Write what is wrong."
                else -> null
            }
            AnomalyKind.ROUTE -> if (routeIssue == null) "Choose a route issue." else null
            AnomalyKind.OTHER -> if (note.isBlank()) "Write a short note." else null
        }
    }

    fun composedNote(note: String, routeIssue: RouteIssueKind?): String {
        val trimmed = note.trim()
        val prefix = when (routeIssue) {
            RouteIssueKind.PATH_WRONG -> "path wrong"
            RouteIssueKind.MISSING_SEGMENT -> "missing segment"
            RouteIssueKind.OTHER -> "other route issue"
            null -> null
        }
        return when {
            prefix == null -> trimmed
            trimmed.isEmpty() -> prefix
            else -> "$prefix · $trimmed"
        }.take(4000)
    }
}
