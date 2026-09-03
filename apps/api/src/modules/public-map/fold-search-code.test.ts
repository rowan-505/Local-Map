import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    foldSearchCode,
    isExactNumericTransportRouteCode,
    isNumericTransportQuery,
} from "./fold-search-code.js";

describe("foldSearchCode", () => {
    it("folds hyphen and space forms of YBS codes to the same token", () => {
        assert.equal(foldSearchCode("YBS-37"), "ybs37");
        assert.equal(foldSearchCode("YBS 37"), "ybs37");
        assert.equal(foldSearchCode("ybs_37"), "ybs37");
    });

    it("does not treat a bare number as a folded YBS code", () => {
        assert.equal(foldSearchCode("37"), "37");
        assert.notEqual(foldSearchCode("YBS-37"), foldSearchCode("37"));
    });
});

describe("numeric transport query helpers", () => {
    it("classifies only digit-only queries of length two or more", () => {
        assert.equal(isNumericTransportQuery("1"), false);
        assert.equal(isNumericTransportQuery("13"), true);
        assert.equal(isNumericTransportQuery("37"), true);
        assert.equal(isNumericTransportQuery("100"), true);
        assert.equal(isNumericTransportQuery("ybs-13"), false);
    });

    it("matches only a delimiter-bounded route number on canonical route types", () => {
        assert.equal(isExactNumericTransportRouteCode("13", "transport_route", "YBS-13"), true);
        assert.equal(isExactNumericTransportRouteCode("13", "bus_route", "13"), true);
        assert.equal(isExactNumericTransportRouteCode("13", "transport_route", "YBS-113"), false);
        assert.equal(isExactNumericTransportRouteCode("13", "transport_route", "213"), false);
        assert.equal(isExactNumericTransportRouteCode("13", "transport_route", "YBS-130"), false);
        assert.equal(isExactNumericTransportRouteCode("13", "transport_stop", "YBS-13"), false);
        assert.equal(
            isExactNumericTransportRouteCode("13", "transport_route_variant", "YBS-13-D0"),
            false,
        );
    });
});
