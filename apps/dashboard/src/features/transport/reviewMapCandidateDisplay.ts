import type { TransportNearbyStopCandidate } from "./types";

export function formatCandidateDistance(meters: number): string {
    if (!Number.isFinite(meters)) {
        return "—";
    }
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
}

export function candidateDisplayName(candidate: TransportNearbyStopCandidate): string {
    return (
        candidate.nameMy?.trim() ||
        candidate.nameEn?.trim() ||
        candidate.name?.trim() ||
        "Unnamed stop"
    );
}

export function candidateMapLabelText(candidate: TransportNearbyStopCandidate): string {
    const name = candidateDisplayName(candidate);
    if (!Number.isFinite(candidate.distanceMeters)) {
        return name;
    }
    return `${name}\n${Math.round(candidate.distanceMeters)} m`;
}
