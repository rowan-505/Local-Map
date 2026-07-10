import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
    SearchAliasesRepository,
    type SearchAliasRow,
} from "./search-aliases.repo.js";
import { SearchAliasesError, SearchAliasesService } from "./search-aliases.service.js";

function makeRow(overrides: Partial<SearchAliasRow> = {}): SearchAliasRow {
    const now = new Date("2026-07-10T00:00:00.000Z");
    return {
        id: 1n,
        entity_type: "place",
        entity_id: 101n,
        alias_text: "RGN",
        normalized_alias: "rgn",
        language_code: "en",
        alias_type: "abbreviation",
        source: "manual",
        is_active: true,
        created_by: 9n,
        created_at: now,
        updated_at: now,
        indexed_display_name: "Yangon International Airport",
        indexed_public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        has_indexed_entity: true,
        ...overrides,
    };
}

class MockSearchAliasesRepository extends SearchAliasesRepository {
    indexedEntity: { entity_type: string; entity_id: bigint; display_name: string; public_id: string } | null =
        {
            entity_type: "place",
            entity_id: 101n,
            display_name: "Yangon International Airport",
            public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        };
    createdRow = makeRow();
    updatedRow = makeRow({ alias_text: "Yangon Airport", normalized_alias: "yangon airport" });
    auditCalls: string[] = [];
    refreshEntityIds: bigint[] = [];

    constructor() {
        super({} as PrismaClient);
    }

    override async findUserIdByPublicId(): Promise<bigint | null> {
        return 9n;
    }

    override async findIndexedEntity() {
        return this.indexedEntity;
    }

    override async create(): Promise<SearchAliasRow> {
        return this.createdRow;
    }

    override async findById(id: bigint): Promise<SearchAliasRow | null> {
        if (id === 1n) {
            return this.updatedRow;
        }
        return null;
    }

    override async update(): Promise<SearchAliasRow | null> {
        return this.updatedRow;
    }

    override async disable(): Promise<SearchAliasRow | null> {
        return makeRow({ is_active: false });
    }

    override async insertAudit(input: { actionType: string }): Promise<void> {
        this.auditCalls.push(input.actionType);
    }
}

describe("SearchAliasesService", () => {
    it("rejects create when the entity is not indexed for search", async () => {
        const repo = new MockSearchAliasesRepository();
        repo.indexedEntity = null;
        const service = new SearchAliasesService(repo, { $queryRaw: async () => [] } as unknown as PrismaClient);

        await assert.rejects(
            () =>
                service.create(
                    { publicId: "actor", ipAddress: null, userAgent: null },
                    {
                        entity_type: "place",
                        entity_id: 101n,
                        alias_text: "RGN",
                        alias_type: "abbreviation",
                        is_active: true,
                    },
                ),
            (error: unknown) => {
                assert.ok(error instanceof SearchAliasesError);
                assert.equal(error.statusCode, 400);
                assert.match(error.message, /not currently indexed/i);
                return true;
            },
        );
    });

    it("creates an alias, refreshes folded aliases, and writes audit", async () => {
        const repo = new MockSearchAliasesRepository();
        const refreshCalls: Array<{ entityType: string; entityIds: bigint[] }> = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = Array.isArray(query) ? query.join("") : String(query);
                if (sql.includes("refresh_search_aliases")) {
                    refreshCalls.push({ entityType: "place", entityIds: [101n] });
                    return [
                        {
                            refresh_search_aliases: {
                                entity_type: "place",
                                entity_ids: ["101"],
                                names_removed: 0,
                                names_added: 1,
                                documents_updated: 1,
                            },
                        },
                    ];
                }
                throw new Error(`unexpected query: ${sql}`);
            },
        } as unknown as PrismaClient;

        const service = new SearchAliasesService(repo, prisma);
        const result = await service.create(
            { publicId: "actor", ipAddress: "127.0.0.1", userAgent: "test" },
            {
                entity_type: "place",
                entity_id: 101n,
                alias_text: "RGN",
                alias_type: "abbreviation",
                language_code: "en",
                source: "manual",
                is_active: true,
            },
        );

        assert.equal(result.alias_text, "RGN");
        assert.equal(result.indexed_entity?.display_name, "Yangon International Airport");
        assert.equal(refreshCalls.length, 1);
        assert.deepEqual(repo.auditCalls, ["search_alias.create"]);
    });

    it("keeps canonical indexed display name separate from alias text on update", async () => {
        const repo = new MockSearchAliasesRepository();
        const prisma = {
            $queryRaw: async () => [
                {
                    refresh_search_aliases: {
                        entity_type: "place",
                        entity_ids: ["101"],
                        names_removed: 0,
                        names_added: 1,
                        documents_updated: 1,
                    },
                },
            ],
        } as unknown as PrismaClient;

        const service = new SearchAliasesService(repo, prisma);
        const result = await service.update(
            { publicId: "actor", ipAddress: null, userAgent: null },
            1n,
            { alias_text: "Yangon Airport" },
        );

        assert.equal(result.alias_text, "Yangon Airport");
        assert.equal(result.indexed_entity?.display_name, "Yangon International Airport");
        assert.deepEqual(repo.auditCalls, ["search_alias.update"]);
    });

    it("disable is idempotent for already inactive aliases", async () => {
        const repo = new MockSearchAliasesRepository();
        repo.findById = async () => makeRow({ is_active: false });
        const service = new SearchAliasesService(repo, { $queryRaw: async () => [] } as unknown as PrismaClient);

        const result = await service.disable(
            { publicId: "actor", ipAddress: null, userAgent: null },
            1n,
        );

        assert.equal(result.is_active, false);
        assert.deepEqual(repo.auditCalls, []);
    });
});
