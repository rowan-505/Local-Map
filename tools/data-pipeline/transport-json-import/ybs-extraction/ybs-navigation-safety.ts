/**
 * YBS route-list refresh safety helpers (pure logic + shared constants).
 */

export const ROUTE_LIST_REFRESH_GESTURE_BLOCKED = "ROUTE_LIST_REFRESH_GESTURE_BLOCKED";
export const ROUTE_LIST_LOADING_OR_REFRESHING = "ROUTE_LIST_LOADING_OR_REFRESHING";
export const TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED =
    "TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED";

export type SwipeScreen =
    | "route_list"
    | "route_detail"
    | "stop_detail"
    | "loading"
    | "unknown";

export type SwipeGesture = {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    durationMs: number;
    purpose?: string;
};

export type SwipeContext = {
    screen: SwipeScreen;
    strictNoRouteListRefresh?: boolean;
};

let strictNoRouteListRefresh = true;

/** Default true: block any route-list pull-to-refresh gesture. */
export function setStrictNoRouteListRefresh(enabled: boolean): void {
    strictNoRouteListRefresh = enabled;
}

export function isStrictNoRouteListRefresh(): boolean {
    return strictNoRouteListRefresh;
}

export function parseStrictNoRouteListRefreshFlag(value: string | undefined): boolean {
    if (value === undefined || value === "") {
        return true;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
    }
    throw new Error('--strict-no-route-list-refresh must be "true" or "false"');
}

/** Finger moves downward on screen (startY < endY). Dangerous on route list (pull-to-refresh). */
export function isDownwardFingerGesture(gesture: SwipeGesture): boolean {
    return gesture.startY < gesture.endY;
}

export type SwipeSafetyEvaluation = {
    allowed: boolean;
    reason: string;
};

export function evaluateSwipeSafety(
    gesture: SwipeGesture,
    context: SwipeContext,
): SwipeSafetyEvaluation {
    const strict = context.strictNoRouteListRefresh ?? strictNoRouteListRefresh;

    if (context.screen === "loading") {
        return {
            allowed: false,
            reason: "route list is loading or refreshing",
        };
    }

    if (isDownwardFingerGesture(gesture)) {
        if (context.screen === "route_detail") {
            return { allowed: true, reason: "allowed on route detail stop list" };
        }

        if (!strict) {
            return { allowed: true, reason: "strict route-list refresh guard disabled" };
        }

        if (context.screen === "route_list") {
            return {
                allowed: false,
                reason: "downward finger on route list can trigger pull-to-refresh",
            };
        }

        return {
            allowed: false,
            reason: `downward finger only allowed on route_detail (current screen: ${context.screen})`,
        };
    }

    if (context.screen === "unknown" && strict) {
        return {
            allowed: false,
            reason: "swipe blocked on unknown screen while strict guard is enabled",
        };
    }

    return { allowed: true, reason: "allowed" };
}
