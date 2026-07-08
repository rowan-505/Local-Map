import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const ADB_MAX_BUFFER = 20 * 1024 * 1024;

function adbCandidatePaths(): string[] {
    const candidates: string[] = [];
    if (process.env.ADB_PATH) {
        candidates.push(process.env.ADB_PATH);
    }
    for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
        if (root) {
            candidates.push(path.join(root, "platform-tools", "adb"));
        }
    }
    candidates.push(path.join(os.homedir(), "Library/Android/sdk/platform-tools/adb"));
    candidates.push("adb");
    return candidates;
}

function resolveAdbPath(): string {
    for (const candidate of adbCandidatePaths()) {
        if (candidate !== "adb" && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return "adb";
}

/** Run adb with the given args. Throws a clear error if adb fails. */
export function runAdb(args: string[]): string {
    const adbPath = resolveAdbPath();
    const command = `${adbPath} ${args.join(" ")}`;

    try {
        return execFileSync(adbPath, args, {
            encoding: "utf8",
            maxBuffer: ADB_MAX_BUFFER,
        }).trim();
    } catch (error: unknown) {
        const execError = error as { code?: string; stderr?: string | Buffer; message?: string };
        const stderr =
            typeof execError.stderr === "string"
                ? execError.stderr.trim()
                : execError.stderr?.toString().trim() ?? "";

        const detail = stderr || execError.message || "Unknown adb error";
        const hint =
            execError.code === "ENOENT"
                ? "\nHint: set ANDROID_HOME, ADB_PATH, or add Android platform-tools to PATH."
                : "";
        throw new Error(`adb failed: ${command}\n${detail}${hint}`);
    }
}

function runAdbForDevice(deviceId: string, args: string[]): string {
    return runAdb(["-s", deviceId, ...args]);
}

function runAdbForDeviceBinary(deviceId: string, args: string[]): Buffer {
    const adbPath = resolveAdbPath();
    const command = `${adbPath} -s ${deviceId} ${args.join(" ")}`;

    try {
        return execFileSync(adbPath, ["-s", deviceId, ...args], {
            maxBuffer: ADB_MAX_BUFFER,
        });
    } catch (error: unknown) {
        const execError = error as { stderr?: string | Buffer; message?: string };
        const stderr =
            typeof execError.stderr === "string"
                ? execError.stderr.trim()
                : execError.stderr?.toString().trim() ?? "";

        const detail = stderr || execError.message || "Unknown adb error";
        throw new Error(`adb failed: ${command}\n${detail}`);
    }
}

function ensureParentDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function extractXmlPayload(raw: string): string {
    const xmlStart = raw.indexOf("<?xml");
    if (xmlStart >= 0) {
        return raw.slice(xmlStart);
    }

    const hierarchyStart = raw.indexOf("<hierarchy");
    if (hierarchyStart >= 0) {
        return raw.slice(hierarchyStart);
    }

    return raw;
}

/** Check that the device is connected and ready. */
export function ensureDevice(deviceId: string): void {
    const state = runAdbForDevice(deviceId, ["get-state"]);
    if (state !== "device") {
        throw new Error(`Device ${deviceId} is not ready. adb get-state returned: ${state}`);
    }
}

function packageFromFocusLine(line: string): string | null {
    const match = line.match(/\b([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\//i);
    return match?.[1] ?? null;
}

/** Return the package name of the app in the foreground. */
export function getFocusedApp(deviceId: string): string {
    const windowOutput = runAdbForDevice(deviceId, ["shell", "dumpsys", "window"]);

    for (const line of windowOutput.split("\n")) {
        if (
            line.includes("mCurrentFocus") ||
            line.includes("mFocusedApp") ||
            line.includes("mTopFullscreenOpaqueWindowState")
        ) {
            const pkg = packageFromFocusLine(line);
            if (pkg) {
                return pkg;
            }
        }
    }

    const activityOutput = runAdbForDevice(deviceId, ["shell", "dumpsys", "activity", "activities"]);

    for (const line of activityOutput.split("\n")) {
        if (
            line.includes("topResumedActivity") ||
            line.includes("ResumedActivity") ||
            line.includes("mResumedActivity")
        ) {
            const pkg = packageFromFocusLine(line);
            if (pkg) {
                return pkg;
            }
        }
    }

    throw new Error(`Could not read focused app on device ${deviceId}`);
}

/**
 * Dump the current UI tree with uiautomator and save XML to a local file.
 * Uses UI XML only. Does not use OCR.
 */
export function dumpUiXml(deviceId: string, localOutputPath: string): void {
    ensureParentDir(localOutputPath);
    const remotePath = "/sdcard/window_dump.xml";
    const adbPath = resolveAdbPath();
    let xml = "";

    try {
        xml = execFileSync(
            adbPath,
            ["-s", deviceId, "exec-out", "uiautomator", "dump", "/dev/tty"],
            { encoding: "utf8", maxBuffer: ADB_MAX_BUFFER },
        );
    } catch {
        runAdbForDevice(deviceId, ["shell", "uiautomator", "dump", remotePath]);
        xml = runAdbForDevice(deviceId, ["shell", "cat", remotePath]);
    }

    const payload = extractXmlPayload(xml);
    if (!payload.includes("<hierarchy")) {
        throw new Error(`UI XML dump did not contain <hierarchy>. Saved path: ${localOutputPath}`);
    }

    fs.writeFileSync(localOutputPath, payload, "utf8");
    console.log(`Saved UI XML: ${localOutputPath}`);
}

/** Save a PNG screenshot from the device. */
export function takeScreenshot(deviceId: string, localOutputPath: string): void {
    ensureParentDir(localOutputPath);
    const png = runAdbForDeviceBinary(deviceId, ["exec-out", "screencap", "-p"]);
    fs.writeFileSync(localOutputPath, png);
    console.log(`Saved screenshot: ${localOutputPath}`);
}

/** Tap one point on the screen. */
export function tap(deviceId: string, x: number, y: number): void {
    runAdbForDevice(deviceId, [
        "shell",
        "input",
        "tap",
        String(Math.round(x)),
        String(Math.round(y)),
    ]);
}

import {
    evaluateSwipeSafety,
    isStrictNoRouteListRefresh,
    ROUTE_LIST_REFRESH_GESTURE_BLOCKED,
    setStrictNoRouteListRefresh,
    type SwipeContext,
    type SwipeGesture,
    type SwipeScreen,
} from "./ybs-navigation-safety.js";

export {
    ROUTE_LIST_REFRESH_GESTURE_BLOCKED,
    setStrictNoRouteListRefresh,
    isStrictNoRouteListRefresh,
    type SwipeContext,
    type SwipeGesture,
    type SwipeScreen,
};

export type SwipeLogEntry = {
    screen: SwipeScreen;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    durationMs: number;
    allowed: boolean;
    reason: string;
    purpose?: string;
};

const swipeLog: SwipeLogEntry[] = [];

export function getSwipeLog(): readonly SwipeLogEntry[] {
    return swipeLog;
}

export function clearSwipeLog(): void {
    swipeLog.length = 0;
}

function logSwipeDecision(gesture: SwipeGesture, context: SwipeContext, evaluation: { allowed: boolean; reason: string }): void {
    const entry: SwipeLogEntry = {
        screen: context.screen,
        startX: gesture.startX,
        startY: gesture.startY,
        endX: gesture.endX,
        endY: gesture.endY,
        durationMs: gesture.durationMs,
        allowed: evaluation.allowed,
        reason: evaluation.reason,
        purpose: gesture.purpose,
    };
    swipeLog.push(entry);
    console.log(
        `[ybs-swipe] screen=${entry.screen} (${entry.startX},${entry.startY})->(${entry.endX},${entry.endY}) ` +
            `duration=${entry.durationMs}ms allowed=${entry.allowed} reason=${entry.reason}` +
            (entry.purpose ? ` purpose=${entry.purpose}` : ""),
    );
}

/** Run adb swipe with route-list refresh guards. */
export function safeSwipe(deviceId: string, gesture: SwipeGesture, context: SwipeContext): void {
    const evaluation = evaluateSwipeSafety(gesture, context);
    logSwipeDecision(gesture, context, evaluation);

    if (!evaluation.allowed) {
        throw new Error(
            `${ROUTE_LIST_REFRESH_GESTURE_BLOCKED}: ${evaluation.reason}. ` +
                `Gesture (${gesture.startX},${gesture.startY})->(${gesture.endX},${gesture.endY}) on screen "${context.screen}".`,
        );
    }

    adbInputSwipe(deviceId, gesture.startX, gesture.startY, gesture.endX, gesture.endY, gesture.durationMs);
}

/** Low-level ADB swipe — internal only; YBS extraction must use safeSwipe(). */
function adbInputSwipe(
    deviceId: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number,
): void {
    runAdbForDevice(deviceId, [
        "shell",
        "input",
        "swipe",
        String(Math.round(x1)),
        String(Math.round(y1)),
        String(Math.round(x2)),
        String(Math.round(y2)),
        String(Math.round(durationMs)),
    ]);
}

/** Press the Android back button. */
export function pressBack(deviceId: string): void {
    runAdbForDevice(deviceId, ["shell", "input", "keyevent", "KEYCODE_BACK"]);
}

/** Wait for a short time between UI actions. */
export function sleep(ms: number): Promise<void> {
    return delay(ms);
}

/** Read screen size from `wm size`. */
export function getScreenSize(deviceId: string): { width: number; height: number } {
    const output = runAdbForDevice(deviceId, ["shell", "wm", "size"]);
    const match = output.match(/(\d+)x(\d+)/);
    if (!match) {
        return { width: 1080, height: 2400 };
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

/*
 * HARD SAFETY RULE (YBS app bug):
 * Refreshing/reloading the YBS route list can cause infinite loading.
 * - Never add a pull-to-refresh gesture here.
 * - Never force-stop or relaunch the app as a recovery step.
 * - Allowed actions on the route list: XML dump, normal scroll up/down,
 *   tap route card bounds, back button from detail to list.
 * - Callers must stop upward swipes once the list stops moving
 *   (a downward-finger swipe at the top of the list IS a pull-to-refresh).
 */

/** Scroll a list up using a center swipe. Route-list use is forbidden — use scrollDownRouteList only. */
export function scrollUp(deviceId: string, screen: SwipeScreen = "route_detail"): void {
    const { width, height } = getScreenSize(deviceId);
    const x = Math.round(width / 2);
    const yStart = Math.round(height * 0.28);
    const yEnd = Math.round(height * 0.78);
    safeSwipe(
        deviceId,
        {
            startX: x,
            startY: yStart,
            endX: x,
            endY: yEnd,
            durationMs: 450,
            purpose: "scrollUp",
        },
        { screen },
    );
}

/**
 * Smaller downward scroll for route detail stop lists.
 * Finger moves up (content scrolls down). Prefer this over scrollDown() for stop capture.
 */
export function scrollDownStopListPage(
    deviceId: string,
    options?: { stepFraction?: number; durationMs?: number; anchorY?: number },
): void {
    const stepFraction = options?.stepFraction ?? 0.22;
    const durationMs = options?.durationMs ?? 380;
    const anchorY = options?.anchorY ?? 0.62;
    const { width, height } = getScreenSize(deviceId);
    const x = Math.round(width / 2);
    const yStart = Math.round(height * (anchorY + stepFraction));
    const yEnd = Math.round(height * anchorY);
    safeSwipe(
        deviceId,
        {
            startX: x,
            startY: yStart,
            endX: x,
            endY: yEnd,
            durationMs,
            purpose: "scrollDownStopListPage",
        },
        { screen: "route_detail" },
    );
}

/** Scroll a list down using a center swipe (finger moves up). */
export function scrollDown(deviceId: string, screen: SwipeScreen = "route_detail"): void {
    const { width, height } = getScreenSize(deviceId);
    const x = Math.round(width / 2);
    const yStart = Math.round(height * 0.78);
    const yEnd = Math.round(height * 0.28);
    safeSwipe(
        deviceId,
        {
            startX: x,
            startY: yStart,
            endX: x,
            endY: yEnd,
            durationMs: 450,
            purpose: "scrollDown",
        },
        { screen },
    );
}

/**
 * Smaller list scroll for route index capture.
 * Finger moves up (startY > endY). Safe on route list only.
 */
export function scrollDownRouteList(deviceId: string, stepFraction = 0.2): void {
    const { width, height } = getScreenSize(deviceId);
    const x = Math.round(width / 2);
    const anchorY = 0.58;
    const yStart = Math.round(height * (anchorY + stepFraction));
    const yEnd = Math.round(height * anchorY);
    safeSwipe(
        deviceId,
        {
            startX: x,
            startY: yStart,
            endX: x,
            endY: yEnd,
            durationMs: 380,
            purpose: "scrollDownRouteList",
        },
        { screen: "route_list" },
    );
}

/**
 * FORBIDDEN: upward scroll on route list uses downward finger movement (pull-to-refresh).
 * @deprecated Never call on YBS route list.
 */
export function scrollUpRouteList(_deviceId: string, _stepFraction = 0.2): never {
    throw new Error(
        `${ROUTE_LIST_REFRESH_GESTURE_BLOCKED}: scrollUpRouteList is forbidden. ` +
            "Manually return to the desired route list position without pull-refresh, then re-run.",
    );
}

/**
 * Scroll a route detail stop list back toward the top.
 * Finger moves downward (content scrolls up). Allowed only on route detail.
 */
export function scrollUpStopListPage(
    deviceId: string,
    options?: { stepFraction?: number; durationMs?: number },
): void {
    const stepFraction = options?.stepFraction ?? 0.4;
    const durationMs = options?.durationMs ?? 500;
    const { width, height } = getScreenSize(deviceId);
    const x = Math.round(width / 2);
    const yStart = Math.round(height * 0.3);
    const yEnd = Math.round(height * Math.min(0.3 + stepFraction, 0.82));
    safeSwipe(
        deviceId,
        {
            startX: x,
            startY: yStart,
            endX: x,
            endY: yEnd,
            durationMs,
            purpose: "scrollUpStopListPage",
        },
        { screen: "route_detail" },
    );
}
