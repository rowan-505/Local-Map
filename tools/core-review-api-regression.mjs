/**
 * API-level Core review regression (no browser).
 */
const API = process.env.API_URL ?? "http://localhost:3001";
const AUTH = process.env.CORE_REVIEW_TOKEN ?? "core-review-regression-dev-token";

const ENTITIES = [
    { slug: "bus-routes", apiSlug: "bus-routes" },
    { slug: "bus-stops", apiSlug: "bus-stops" },
    { slug: "roads", apiSlug: "streets" },
    { slug: "buildings", apiSlug: "buildings" },
    { slug: "places", apiSlug: "places" },
    { slug: "bus-route-variants", apiSlug: "bus-route-variants" },
    { slug: "landuse", apiSlug: "landuse" },
    { slug: "water-lines", apiSlug: "water-lines" },
    { slug: "water-polygons", apiSlug: "water-polygons" },
    { slug: "addresses", apiSlug: "addresses" },
    { slug: "admin-areas", apiSlug: "admin-areas" },
];

async function api(path, init = {}) {
    const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${AUTH}`,
            ...(init.headers ?? {}),
        },
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
}

function rowId(row) {
    return row.publicId ?? row.public_id ?? row.id ?? null;
}

async function main() {
    const results = [];
    for (const entity of ENTITIES) {
        const { slug, apiSlug } = entity;
        const r = { slug, list: false, search: false, sort: false, pageSize: false, detail: false, patch: false, total: 0, id: null, errors: [] };

        const list = await api(`/core-review/${apiSlug}?page=1&pageSize=25&sortBy=updated_at&sortOrder=desc`);
        r.list = list.ok;
        r.total = list.json?.pagination?.total ?? 0;
        if (!list.ok) r.errors.push(`list:${list.status}`);

        const search = await api(`/core-review/${apiSlug}?page=1&pageSize=25&search=a`);
        r.search = search.ok;
        if (!search.ok) r.errors.push(`search:${search.status}`);

        const sort = await api(`/core-review/${apiSlug}?page=1&pageSize=25&sortBy=updated_at&sortOrder=asc`);
        r.sort = sort.ok;
        if (!sort.ok) r.errors.push(`sort:${sort.status}`);

        const ps = await api(`/core-review/${apiSlug}?page=1&pageSize=50`);
        r.pageSize = ps.ok;
        if (!ps.ok) r.errors.push(`pageSize:${ps.status}`);

        const row = list.json?.data?.[0];
        r.id = row ? rowId(row) : null;
        if (r.id) {
            const detail = await api(`/core-review/${apiSlug}/${encodeURIComponent(r.id)}`);
            r.detail = detail.ok;
            if (!detail.ok) r.errors.push(`detail:${detail.status}`);

            const patch = await api(`/core-review/${apiSlug}/${encodeURIComponent(r.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isVerified: Boolean(row.isVerified ?? row.is_verified ?? false) }),
            });
            r.patch = patch.ok;
            if (!patch.ok) r.errors.push(`patch:${patch.status} ${JSON.stringify(patch.json)?.slice(0, 120)}`);
        }

        results.push(r);
        const mark = r.errors.length === 0 ? "PASS" : "FAIL";
        console.log(
            `[${mark}] ${slug} total=${r.total} list=${r.list} search=${r.search} sort=${r.sort} pageSize=${r.pageSize} detail=${r.detail} patch=${r.patch}${r.errors.length ? " ERR:" + r.errors.join(";") : ""}`,
        );
    }

    const failed = results.filter((r) => r.errors.length > 0);
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
