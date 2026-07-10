import type { GoldenSearchQueryScenario } from "./search-quality-golden.js";

/**
 * Curated public-search golden scenarios.
 *
 * Each scenario uses synthetic candidates that represent realistic index rows.
 * Rankings use the same `explainUnifiedSearchScore` logic as production SQL.
 *
 * To add a query: append a scenario here, then run `npm run test:search-quality`.
 * See docs/learning/08-search-address-routing/search-quality-golden-queries.md
 */
export const GOLDEN_SEARCH_QUERY_SCENARIOS: readonly GoldenSearchQueryScenario[] = [
    {
        name: "english yangon city outranks weak fuzzy stops",
        query: "yangon",
        candidates: [
            {
                id: "yangon-region",
                entityType: "admin_area",
                entityId: "101",
                displayName: "Yangon Region",
                importanceScore: 90,
                doc: {
                    displayName: "Yangon Region",
                    primaryNameEn: "Yangon Region",
                    entityType: "admin_area",
                    trigramSimilarity: 0.62,
                    importanceScore: 90,
                    isVerified: true,
                    reviewStatus: "verified",
                },
            },
            {
                id: "yangon-weak-stop",
                entityType: "transport_stop",
                entityId: "102",
                displayName: "Road Corner Near Yangon Highway",
                doc: {
                    displayName: "Road Corner Near Yangon Highway",
                    entityType: "transport_stop",
                    trigramSimilarity: 0.26,
                    reviewStatus: "needs_review",
                },
            },
            {
                id: "ghost-yangon-stop",
                entityType: "transport_stop",
                entityId: "103",
                displayName: "Deleted Yangon Stop",
                excludedFromResults: true,
                doc: {
                    displayName: "Deleted Yangon Stop",
                    entityType: "transport_stop",
                    trigramSimilarity: 0.95,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "yangon-region", topN: 1 }],
            forbiddenIds: ["ghost-yangon-stop"],
            outranks: [{ winnerId: "yangon-region", loserId: "yangon-weak-stop" }],
        },
    },
    {
        name: "english sule prefers verified exact stop",
        query: "sule",
        candidates: [
            {
                id: "sule-verified-stop",
                entityType: "transport_stop",
                entityId: "201",
                displayName: "Sule",
                stopType: "stop",
                doc: {
                    displayName: "Sule",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.5,
                    reviewStatus: "verified",
                    isVerified: true,
                },
            },
            {
                id: "sule-needs-review-stop",
                entityType: "transport_stop",
                entityId: "202",
                displayName: "Sule",
                stopType: "stop",
                doc: {
                    displayName: "Sule",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.5,
                    reviewStatus: "needs_review",
                    isVerified: false,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "sule-verified-stop", topN: 1 }],
            outranks: [{ winnerId: "sule-verified-stop", loserId: "sule-needs-review-stop" }],
        },
    },
    {
        name: "english kyaukse verified district outranks fuzzy stop",
        query: "kyaukse",
        candidates: [
            {
                id: "kyaukse-district",
                entityType: "admin_area",
                entityId: "301",
                displayName: "Kyaukse Township",
                importanceScore: 20,
                doc: {
                    displayName: "Kyaukse Township",
                    entityType: "admin_area",
                    trigramSimilarity: 0.45,
                    importanceScore: 20,
                    isVerified: true,
                },
            },
            {
                id: "kyaukse-fuzzy-stop",
                entityType: "transport_stop",
                entityId: "302",
                displayName: "Rural Stop Near Kyaukse Road",
                doc: {
                    displayName: "Rural Stop Near Kyaukse Road",
                    entityType: "transport_stop",
                    trigramSimilarity: 0.28,
                    reviewStatus: "needs_review",
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "kyaukse-district", topN: 2 }],
            outranks: [{ winnerId: "kyaukse-district", loserId: "kyaukse-fuzzy-stop" }],
        },
    },
    {
        name: "english airport prefers airport station",
        query: "airport",
        candidates: [
            {
                id: "yangon-airport-station",
                entityType: "transport_stop",
                entityId: "401",
                displayName: "Yangon International Airport",
                stopType: "airport",
                doc: {
                    displayName: "Yangon International Airport",
                    entityType: "transport_stop",
                    stopType: "airport",
                    trigramSimilarity: 0.55,
                    reviewStatus: "reviewed",
                },
            },
            {
                id: "airport-road-stop",
                entityType: "transport_stop",
                entityId: "402",
                displayName: "Near Airport Road Junction",
                stopType: "stop",
                doc: {
                    displayName: "Near Airport Road Junction",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.31,
                    reviewStatus: "needs_review",
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "yangon-airport-station", topN: 2 }],
            outranks: [{ winnerId: "yangon-airport-station", loserId: "airport-road-stop" }],
        },
    },
    {
        name: "english ybs 36 exact route code",
        query: "ybs 36",
        candidates: [
            {
                id: "ybs-36-route",
                entityType: "transport_route",
                entityId: "501",
                displayName: "YBS 36",
                transportMode: "bus",
                doc: {
                    code: "YBS-36",
                    displayName: "YBS 36",
                    entityType: "transport_route",
                    trigramSimilarity: 0.36,
                    allTokensMatch: true,
                },
            },
            {
                id: "ybs-36-fuzzy-name",
                entityType: "transport_route",
                entityId: "502",
                displayName: "YBS 36 Downtown",
                transportMode: "bus",
                doc: {
                    displayName: "YBS 36 Downtown",
                    entityType: "transport_route",
                    trigramSimilarity: 0.33,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "ybs-36-route", topN: 1 }],
            outranks: [{ winnerId: "ybs-36-route", loserId: "ybs-36-fuzzy-name" }],
        },
    },
    {
        name: "english 36 bus exact route code variant",
        query: "36 bus",
        candidates: [
            {
                id: "bus-36-route",
                entityType: "transport_route",
                entityId: "601",
                displayName: "Route 36",
                transportMode: "bus",
                doc: {
                    code: "YBS-36",
                    displayName: "Route 36",
                    entityType: "transport_route",
                    trigramSimilarity: 0.22,
                    allTokensMatch: true,
                },
            },
            {
                id: "bus-36-weak-place",
                entityType: "place",
                entityId: "602",
                displayName: "Bus Depot 36",
                doc: {
                    displayName: "Bus Depot 36",
                    entityType: "place",
                    trigramSimilarity: 0.29,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "bus-36-route", topN: 2 }],
            outranks: [{ winnerId: "bus-36-route", loserId: "bus-36-weak-place" }],
        },
    },
    {
        name: "myanmar yangon prefers myanmar primary name",
        query: "ရန်ကုန်",
        candidates: [
            {
                id: "yangon-my-admin",
                entityType: "admin_area",
                entityId: "701",
                displayName: "ရန်ကုန်တိုင်းဒေသကြီး",
                importanceScore: 85,
                doc: {
                    displayName: "ရန်ကုန်တိုင်းဒေသကြီး",
                    primaryNameMy: "ရန်ကုန်",
                    primaryNameEn: "Yangon Region",
                    entityType: "admin_area",
                    trigramSimilarity: 0.58,
                    importanceScore: 85,
                    isVerified: true,
                },
            },
            {
                id: "yangon-my-weak-stop",
                entityType: "transport_stop",
                entityId: "702",
                displayName: "ရန်ကုန်လမ်းမအနီး",
                doc: {
                    displayName: "ရန်ကုန်လမ်းမအနီး",
                    primaryNameMy: "ရန်ကုန်လမ်းမအနီး",
                    entityType: "transport_stop",
                    trigramSimilarity: 0.24,
                    reviewStatus: "needs_review",
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "yangon-my-admin", topN: 2 }],
            outranks: [{ winnerId: "yangon-my-admin", loserId: "yangon-my-weak-stop" }],
        },
    },
    {
        name: "myanmar sule exact myanmar stop",
        query: "ဆူးလေ",
        candidates: [
            {
                id: "sule-my-stop",
                entityType: "transport_stop",
                entityId: "801",
                displayName: "ဆူးလေ",
                stopType: "stop",
                doc: {
                    displayName: "ဆူးလေ",
                    primaryNameMy: "ဆူးလေ",
                    primaryNameEn: "Sule",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.52,
                    reviewStatus: "verified",
                    isVerified: true,
                },
            },
            {
                id: "sule-my-fuzzy",
                entityType: "place",
                entityId: "802",
                displayName: "ဆူးလေအနီး",
                doc: {
                    displayName: "ဆူးလေအနီး",
                    primaryNameMy: "ဆူးလေအနီး",
                    entityType: "place",
                    trigramSimilarity: 0.27,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "sule-my-stop", topN: 2 }],
            outranks: [{ winnerId: "sule-my-stop", loserId: "sule-my-fuzzy" }],
        },
    },
    {
        name: "myanmar hledan exact stop",
        query: "လှည်းတန်း",
        candidates: [
            {
                id: "hledan-stop",
                entityType: "transport_stop",
                entityId: "901",
                displayName: "လှည်းတန်း",
                stopType: "stop",
                doc: {
                    displayName: "လှည်းတန်း",
                    primaryNameMy: "လှည်းတန်း",
                    primaryNameEn: "Hledan",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.5,
                    reviewStatus: "reviewed",
                },
            },
            {
                id: "hledan-fuzzy-road",
                entityType: "street_group",
                entityId: "902",
                displayName: "လှည်းတန်းလမ်းနီး",
                doc: {
                    displayName: "လှည်းတန်းလမ်းနီး",
                    primaryNameMy: "လှည်းတန်းလမ်းနီး",
                    entityType: "street_group",
                    trigramSimilarity: 0.3,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "hledan-stop", topN: 2 }],
            outranks: [{ winnerId: "hledan-stop", loserId: "hledan-fuzzy-road" }],
        },
    },
    {
        name: "transport route code exact match",
        query: "ybs-36",
        candidates: [
            {
                id: "route-code-exact",
                entityType: "transport_route",
                entityId: "1001",
                displayName: "YBS 36",
                transportMode: "bus",
                doc: {
                    code: "YBS-36",
                    displayName: "YBS 36",
                    entityType: "transport_route",
                    trigramSimilarity: 0.18,
                },
            },
            {
                id: "route-code-fuzzy",
                entityType: "transport_route",
                entityId: "1002",
                displayName: "YBS 36 Extension",
                transportMode: "bus",
                doc: {
                    displayName: "YBS 36 Extension",
                    entityType: "transport_route",
                    trigramSimilarity: 0.34,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "route-code-exact", topN: 1 }],
            outranks: [{ winnerId: "route-code-exact", loserId: "route-code-fuzzy" }],
        },
    },
    {
        name: "transport station name exact match",
        query: "insein",
        candidates: [
            {
                id: "insein-station",
                entityType: "transport_stop",
                entityId: "1101",
                displayName: "Insein",
                stopType: "station",
                doc: {
                    displayName: "Insein",
                    entityType: "transport_stop",
                    stopType: "station",
                    trigramSimilarity: 0.7,
                    reviewStatus: "reviewed",
                },
            },
            {
                id: "insein-weak-place",
                entityType: "place",
                entityId: "1102",
                displayName: "Near Insein Junction",
                doc: {
                    displayName: "Near Insein Junction",
                    entityType: "place",
                    trigramSimilarity: 0.32,
                    importanceScore: 40,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "insein-station", topN: 2 }],
            outranks: [{ winnerId: "insein-station", loserId: "insein-weak-place" }],
        },
    },
    {
        name: "transport terminal name exact match",
        query: "aung mingalar",
        candidates: [
            {
                id: "aung-mingalar-terminal",
                entityType: "transport_terminal",
                entityId: "1201",
                displayName: "Aung Mingalar Highway Bus Terminal",
                doc: {
                    displayName: "Aung Mingalar Highway Bus Terminal",
                    entityType: "transport_terminal",
                    trigramSimilarity: 0.48,
                    allTokensMatch: true,
                    reviewStatus: "reviewed",
                },
            },
            {
                id: "aung-mingalar-weak-stop",
                entityType: "transport_stop",
                entityId: "1202",
                displayName: "Road Near Aung Mingalar",
                stopType: "stop",
                doc: {
                    displayName: "Road Near Aung Mingalar",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.27,
                    reviewStatus: "needs_review",
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "aung-mingalar-terminal", topN: 2 }],
            outranks: [
                { winnerId: "aung-mingalar-terminal", loserId: "aung-mingalar-weak-stop" },
            ],
        },
    },
    {
        name: "transport stop name exact match",
        query: "hledan",
        candidates: [
            {
                id: "hledan-exact-stop",
                entityType: "transport_stop",
                entityId: "1301",
                displayName: "Hledan",
                stopType: "stop",
                doc: {
                    displayName: "Hledan",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.56,
                    reviewStatus: "reviewed",
                },
            },
            {
                id: "hledan-fuzzy-stop",
                entityType: "transport_stop",
                entityId: "1302",
                displayName: "Hledan Road Corner",
                stopType: "stop",
                doc: {
                    displayName: "Hledan Road Corner",
                    entityType: "transport_stop",
                    stopType: "stop",
                    trigramSimilarity: 0.29,
                    reviewStatus: "needs_review",
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "hledan-exact-stop", topN: 1 }],
            outranks: [{ winnerId: "hledan-exact-stop", loserId: "hledan-fuzzy-stop" }],
        },
    },
    {
        name: "relevance threshold drops weak fuzzy-only match",
        query: "kyauk",
        candidates: [
            {
                id: "kyauk-strong",
                entityType: "admin_area",
                entityId: "1401",
                displayName: "Kyaukse Township",
                doc: {
                    displayName: "Kyaukse Township",
                    entityType: "admin_area",
                    trigramSimilarity: 0.42,
                },
            },
            {
                id: "kyauk-too-weak",
                entityType: "transport_stop",
                entityId: "1402",
                displayName: "Regional Office Near Kyauk",
                doc: {
                    displayName: "Regional Office Near Kyauk",
                    trigramText: "regional office near kyauk township",
                    trigramSimilarity: 0.18,
                },
            },
        ],
        expect: {
            requiredInTop: [{ id: "kyauk-strong", topN: 1 }],
            forbiddenIds: ["kyauk-too-weak"],
            maxEligible: 1,
        },
    },
];
