import assert from "node:assert/strict";
import test from "node:test";

import { canDashboardWrite, hasDashboardAccess, isViewer } from "./jwtRoles.js";

test("dashboard UX capabilities mirror API role policy", () => {
    assert.equal(hasDashboardAccess(["user"]), false);
    assert.equal(hasDashboardAccess(["viewer"]), true);
    assert.equal(canDashboardWrite(["viewer"]), false);
    assert.equal(canDashboardWrite(["admin"]), true);
    assert.equal(canDashboardWrite(["super_admin"]), true);
    assert.equal(isViewer(["viewer"]), true);
    assert.equal(isViewer(["viewer", "admin"]), false);
});
