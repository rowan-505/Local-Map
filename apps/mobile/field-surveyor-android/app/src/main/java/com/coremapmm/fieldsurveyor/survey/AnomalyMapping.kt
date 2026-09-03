package com.coremapmm.fieldsurveyor.survey

enum class AnomalyKind {
    MOVED,
    MISSING,
    DATA,
    ROUTE,
    OTHER,
}

object AnomalyMapping {
    fun reportTypeCode(kind: AnomalyKind): String {
        return when (kind) {
            AnomalyKind.MOVED -> "wrong_location"
            AnomalyKind.MISSING -> "missing_item"
            AnomalyKind.DATA -> "wrong_info"
            AnomalyKind.ROUTE -> "transport_issue"
            AnomalyKind.OTHER -> "other_map_issue"
        }
    }

    fun targetEntityType(kind: AnomalyKind, hasSelectedStop: Boolean): String {
        return when (kind) {
            AnomalyKind.ROUTE -> "route"
            AnomalyKind.MOVED, AnomalyKind.MISSING, AnomalyKind.DATA -> "stop"
            AnomalyKind.OTHER -> if (hasSelectedStop) "stop" else "variant"
        }
    }
}
