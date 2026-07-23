/**
 * Reusable in-memory fixture builders for transport review regression tests.
 * Never touches production. Used with mock Prisma + rollback-style transactions.
 */

export const FIXTURE_UUIDS = {
    route: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    variant: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    variantAlt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
    stopCurrent: "11111111-1111-4111-8111-111111111111",
    stopCandidate: "22222222-2222-4222-8222-222222222222",
    stopChild: "33333333-3333-4333-8333-333333333333",
    terminalA: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    terminalB: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    path: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    actorUser: "ffffffff-ffff-4fff-8fff-ffffffffffff",
} as const;

export type FixtureStop = {
    id: bigint;
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    mode: string;
    stop_type: string;
    admin_area_id: bigint | number | null;
    parent_stop_id: bigint | null;
    review_status: string;
    confidence_score: number;
    is_active: boolean;
    deleted_at: string | null;
    longitude: number;
    latitude: number;
};

export type FixtureTerminal = {
    id: bigint;
    public_id: string;
    linked_stop_id: bigint | null;
    name: string;
    review_status: string;
    is_active: boolean;
    deleted_at: string | null;
};

export type FixtureRouteStop = {
    id: bigint;
    route_variant_id: bigint;
    stop_id: bigint;
    stop_sequence: number;
    travel_time_from_previous_seconds: number | null;
    waiting_time_seconds: number | null;
};

export type FixtureVariant = {
    id: bigint;
    public_id: string;
    route_id: bigint;
    variant_code: string;
    origin_stop_id: bigint | null;
    destination_stop_id: bigint | null;
    review_status: string;
    is_active: boolean;
    deleted_at: string | null;
};

export type FixtureRoute = {
    id: bigint;
    public_id: string;
    route_code: string;
    mode: string;
    review_status: string;
    is_active: boolean;
    deleted_at: string | null;
};

export type FixturePath = {
    id: bigint;
    public_id: string;
    route_variant_id: bigint;
    review_status: string;
    path_kind: string;
    coordinates: Array<[number, number]>;
    deleted_at: string | null;
};

export type FixtureStopName = {
    id: bigint;
    stop_id: bigint;
    language_code: string;
    name: string;
    is_primary: boolean;
};

export type FixtureWorld = {
    routes: FixtureRoute[];
    variants: FixtureVariant[];
    stops: FixtureStop[];
    stopNames: FixtureStopName[];
    routeStops: FixtureRouteStop[];
    terminals: FixtureTerminal[];
    paths: FixturePath[];
    auditActorUserId: string;
};

let nextId = 1000n;

export function allocId(): bigint {
    nextId += 1n;
    return nextId;
}

export function resetFixtureIds(start = 1000n): void {
    nextId = start;
}

function newUuid(fallbackSuffix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `00000000-0000-4000-8000-${fallbackSuffix.padStart(12, "0")}`;
}

export function buildStop(overrides: Partial<FixtureStop> = {}): FixtureStop {
    const id = overrides.id ?? allocId();
    return {
        id,
        public_id: overrides.public_id ?? newUuid(String(id)),
        name: overrides.name ?? `Stop ${id}`,
        name_mm: overrides.name_mm ?? null,
        name_en: overrides.name_en ?? `Stop ${id}`,
        mode: overrides.mode ?? "bus",
        stop_type: overrides.stop_type ?? "stop",
        admin_area_id: overrides.admin_area_id !== undefined ? overrides.admin_area_id : 5801n,
        parent_stop_id: overrides.parent_stop_id ?? null,
        review_status: overrides.review_status ?? "needs_review",
        confidence_score: overrides.confidence_score ?? 70,
        is_active: overrides.is_active ?? true,
        deleted_at: overrides.deleted_at ?? null,
        longitude: overrides.longitude ?? 96.15,
        latitude: overrides.latitude ?? 16.8,
    };
}

export function buildTerminal(overrides: Partial<FixtureTerminal> = {}): FixtureTerminal {
    const id = overrides.id ?? allocId();
    return {
        id,
        public_id: overrides.public_id ?? newUuid(String(id)),
        linked_stop_id: overrides.linked_stop_id ?? null,
        name: overrides.name ?? `Terminal ${id}`,
        review_status: overrides.review_status ?? "reviewed",
        is_active: overrides.is_active ?? true,
        deleted_at: overrides.deleted_at ?? null,
    };
}

export function buildRoute(overrides: Partial<FixtureRoute> = {}): FixtureRoute {
    const id = overrides.id ?? allocId();
    return {
        id,
        public_id: overrides.public_id ?? FIXTURE_UUIDS.route,
        route_code: overrides.route_code ?? `YBS-${id}`,
        mode: overrides.mode ?? "bus",
        review_status: overrides.review_status ?? "needs_review",
        is_active: overrides.is_active ?? true,
        deleted_at: overrides.deleted_at ?? null,
    };
}

export function buildVariant(overrides: Partial<FixtureVariant> = {}): FixtureVariant {
    const id = overrides.id ?? allocId();
    return {
        id,
        public_id: overrides.public_id ?? FIXTURE_UUIDS.variant,
        route_id: overrides.route_id ?? 1n,
        variant_code: overrides.variant_code ?? `VAR-${id}`,
        origin_stop_id: overrides.origin_stop_id ?? null,
        destination_stop_id: overrides.destination_stop_id ?? null,
        review_status: overrides.review_status ?? "needs_review",
        is_active: overrides.is_active ?? true,
        deleted_at: overrides.deleted_at ?? null,
    };
}

export function buildRouteStop(overrides: Partial<FixtureRouteStop> = {}): FixtureRouteStop {
    return {
        id: overrides.id ?? allocId(),
        route_variant_id: overrides.route_variant_id ?? 1n,
        stop_id: overrides.stop_id ?? 1n,
        stop_sequence: overrides.stop_sequence ?? 1,
        travel_time_from_previous_seconds: overrides.travel_time_from_previous_seconds ?? null,
        waiting_time_seconds: overrides.waiting_time_seconds ?? null,
    };
}

export function buildPath(overrides: Partial<FixturePath> = {}): FixturePath {
    const id = overrides.id ?? allocId();
    return {
        id,
        public_id: overrides.public_id ?? FIXTURE_UUIDS.path,
        route_variant_id: overrides.route_variant_id ?? 1n,
        review_status: overrides.review_status ?? "needs_review",
        path_kind: overrides.path_kind ?? "manual",
        coordinates: overrides.coordinates ?? [
            [96.15, 16.8],
            [96.16, 16.81],
        ],
        deleted_at: overrides.deleted_at ?? null,
    };
}

export function buildStopName(overrides: Partial<FixtureStopName> = {}): FixtureStopName {
    return {
        id: overrides.id ?? allocId(),
        stop_id: overrides.stop_id ?? 1n,
        language_code: overrides.language_code ?? "en",
        name: overrides.name ?? "Stop",
        is_primary: overrides.is_primary ?? true,
    };
}

export type TerminalScenario = "none" | "canonical_only" | "duplicate_only" | "both";

export function buildMergeWorld(options: {
    terminals?: TerminalScenario;
    sameVariant?: boolean;
    differentVariant?: boolean;
    canonicalParentIsDuplicate?: boolean;
    duplicateHasChildren?: boolean;
    duplicateNames?: boolean;
    adminAreaId?: bigint | number | null;
    originDestinationRefs?: boolean;
} = {}): FixtureWorld {
    resetFixtureIds(1n);
    const route = buildRoute({ id: 1n, public_id: FIXTURE_UUIDS.route });
    const variant = buildVariant({
        id: 2n,
        public_id: FIXTURE_UUIDS.variant,
        route_id: route.id,
    });
    const otherVariant = buildVariant({
        id: 3n,
        public_id: FIXTURE_UUIDS.variantAlt,
        route_id: route.id,
        variant_code: "YBS-ALT",
    });

    const adminAreaId = options.adminAreaId === undefined ? 5801n : options.adminAreaId;
    const canonical = buildStop({
        id: 10n,
        public_id: FIXTURE_UUIDS.stopCurrent,
        name: "Canonical",
        name_en: "Canonical",
        admin_area_id: adminAreaId,
        parent_stop_id: options.canonicalParentIsDuplicate ? 11n : null,
    });
    const duplicate = buildStop({
        id: 11n,
        public_id: FIXTURE_UUIDS.stopCandidate,
        name: options.duplicateNames ? "Canonical" : "Duplicate",
        name_en: options.duplicateNames ? "Canonical" : "Duplicate",
        admin_area_id: adminAreaId,
    });
    const child = buildStop({
        id: 12n,
        public_id: FIXTURE_UUIDS.stopChild,
        name: "Child",
        parent_stop_id: options.duplicateHasChildren ? duplicate.id : null,
        admin_area_id: null,
    });

    const terminals: FixtureTerminal[] = [];
    const scenario = options.terminals ?? "none";
    if (scenario === "canonical_only" || scenario === "both") {
        terminals.push(
            buildTerminal({
                id: 20n,
                public_id: FIXTURE_UUIDS.terminalA,
                linked_stop_id: canonical.id,
                name: "Canonical terminal",
            }),
        );
    }
    if (scenario === "duplicate_only" || scenario === "both") {
        terminals.push(
            buildTerminal({
                id: 21n,
                public_id: FIXTURE_UUIDS.terminalB,
                linked_stop_id: duplicate.id,
                name: "Duplicate terminal",
            }),
        );
    }

    const routeStops: FixtureRouteStop[] = [];
    if (options.sameVariant) {
        routeStops.push(
            buildRouteStop({
                id: 30n,
                route_variant_id: variant.id,
                stop_id: canonical.id,
                stop_sequence: 10,
            }),
            buildRouteStop({
                id: 31n,
                route_variant_id: variant.id,
                stop_id: duplicate.id,
                stop_sequence: 20,
            }),
        );
    }
    if (options.differentVariant) {
        routeStops.push(
            buildRouteStop({
                id: 32n,
                route_variant_id: variant.id,
                stop_id: canonical.id,
                stop_sequence: 5,
            }),
            buildRouteStop({
                id: 33n,
                route_variant_id: otherVariant.id,
                stop_id: duplicate.id,
                stop_sequence: 5,
            }),
        );
    }

    if (options.originDestinationRefs) {
        variant.origin_stop_id = duplicate.id;
        variant.destination_stop_id = duplicate.id;
    }

    const stopNames: FixtureStopName[] = [
        buildStopName({
            id: 40n,
            stop_id: canonical.id,
            language_code: "en",
            name: canonical.name_en ?? canonical.name,
        }),
        buildStopName({
            id: 41n,
            stop_id: duplicate.id,
            language_code: "en",
            name: duplicate.name_en ?? duplicate.name,
        }),
    ];
    if (options.duplicateNames) {
        stopNames.push(
            buildStopName({
                id: 42n,
                stop_id: duplicate.id,
                language_code: "my",
                name: "တူညီ",
            }),
        );
    }

    return {
        routes: [route],
        variants: [variant, otherVariant],
        stops: [canonical, duplicate, child],
        stopNames,
        routeStops,
        terminals,
        paths: [buildPath({ id: 50n, route_variant_id: variant.id })],
        auditActorUserId: FIXTURE_UUIDS.actorUser,
    };
}

export function buildOrderedVariantStops(count: number, variantId = 2n): FixtureRouteStop[] {
    return Array.from({ length: count }, (_, i) =>
        buildRouteStop({
            id: BigInt(100 + i),
            route_variant_id: variantId,
            stop_id: BigInt(i + 1),
            stop_sequence: i + 1,
            travel_time_from_previous_seconds: i === 0 ? null : 60,
            waiting_time_seconds: 0,
        }),
    );
}

/** Snapshot a world for rollback comparison. */
export function cloneWorld(world: FixtureWorld): FixtureWorld {
    return structuredClone(world);
}
