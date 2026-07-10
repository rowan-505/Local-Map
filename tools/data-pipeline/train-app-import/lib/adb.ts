/**
 * Thin re-exports of YBS ADB helpers for train app extraction.
 * Reuses dump/screenshot/scroll utilities — no duplication.
 */

import { DEFAULT_TRAIN_APP_PACKAGE } from "./train-import-constants.js";

export {
    dumpUiXml,
    ensureDevice,
    getFocusedApp,
    getScreenSize,
    pressBack,
    scrollDownRouteList as scrollDownTrainList,
    scrollDownStopListPage,
    sleep,
    takeScreenshot,
    tap,
} from "../../transport-json-import/ybs-extraction/adb.js";

/** Resolve Android package name; rejects common device-id mix-up in TRAIN_APP_PACKAGE. */
export function resolveTrainAppPackage(explicitPackage?: string): string {
    const value = (explicitPackage ?? process.env.TRAIN_APP_PACKAGE ?? DEFAULT_TRAIN_APP_PACKAGE).trim();

    if (!value.includes(".") && /^[A-Z0-9_-]+$/i.test(value)) {
        throw new Error(
            `TRAIN_APP_PACKAGE looks like a device id ("${value}"), not an app package. ` +
                `Use: export ADB_DEVICE_ID=${value} and ` +
                `export TRAIN_APP_PACKAGE=${DEFAULT_TRAIN_APP_PACKAGE}`,
        );
    }

    return value;
}
