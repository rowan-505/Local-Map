import { Prisma, type PrismaClient } from "@prisma/client";

import { ENGLISH_LANGUAGE_CODE, MYANMAR_LANGUAGE_CODES, trimName } from "./derive-display-name.js";

export type PrimaryNameSlots = {
    /** Omit key to leave that language unchanged; null clears primary official row(s). */
    name_mm?: string | null | undefined;
    name_en?: string | null | undefined;
};

export type EntityNamesTableConfig = {
    namesTable: string;
    fkColumn: string;
    entityId: bigint;
    /** Language code stored on INSERT for Myanmar (table CHECK may only allow `mm`). */
    myanmarWriteLanguageCode: "my" | "mm";
    myanmarScriptCode: string;
    englishScriptCode: string;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

function myanmarLanguageInList(): Prisma.Sql {
    return Prisma.sql`(${Prisma.join(MYANMAR_LANGUAGE_CODES.map((c) => Prisma.sql`${c}`), ", ")})`;
}

async function clearPrimaryOfficial(
    tx: DbClient,
    config: EntityNamesTableConfig,
    languageFilter: Prisma.Sql
): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
        DELETE FROM ${Prisma.raw(config.namesTable)} AS n
        WHERE n.${Prisma.raw(config.fkColumn)} = ${config.entityId}
          AND n.name_type = 'official'
          AND n.is_primary IS TRUE
          AND ${languageFilter}
    `);
}

async function insertPrimaryOfficial(
    tx: DbClient,
    config: EntityNamesTableConfig,
    args: {
        languageCode: string;
        scriptCode: string;
        name: string;
        searchWeight: number;
    }
): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
        INSERT INTO ${Prisma.raw(config.namesTable)} (
            ${Prisma.raw(config.fkColumn)},
            name,
            language_code,
            script_code,
            name_type,
            is_primary,
            search_weight
        )
        VALUES (
            ${config.entityId},
            ${args.name},
            ${args.languageCode},
            ${args.scriptCode},
            'official',
            TRUE,
            ${args.searchWeight}
        )
    `);
}

/**
 * Upserts primary official Myanmar/English name rows for one entity.
 * Enforces at most one primary official name per language via delete-then-insert.
 */
export async function syncPrimaryOfficialNames(
    tx: DbClient,
    config: EntityNamesTableConfig,
    slots: PrimaryNameSlots
): Promise<void> {
    if (slots.name_mm !== undefined) {
        await clearPrimaryOfficial(
            tx,
            config,
            Prisma.sql`(lower(trim(n.language_code)) IN ${myanmarLanguageInList()} OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR')`
        );
        const mm = trimName(slots.name_mm);
        if (mm) {
            await insertPrimaryOfficial(tx, config, {
                languageCode: config.myanmarWriteLanguageCode,
                scriptCode: config.myanmarScriptCode,
                name: mm,
                searchWeight: 100,
            });
        }
    }

    if (slots.name_en !== undefined) {
        await clearPrimaryOfficial(
            tx,
            config,
            Prisma.sql`(lower(trim(n.language_code)) = ${ENGLISH_LANGUAGE_CODE} OR upper(trim(coalesce(n.script_code, ''))) = 'LATN')`
        );
        const en = trimName(slots.name_en);
        if (en) {
            const mmPresent =
                slots.name_mm !== undefined ? trimName(slots.name_mm) !== null : undefined;
            await insertPrimaryOfficial(tx, config, {
                languageCode: ENGLISH_LANGUAGE_CODE,
                scriptCode: config.englishScriptCode,
                name: en,
                searchWeight: mmPresent === false ? 100 : 90,
            });
        }
    }
}

export const BUILDING_NAMES_CONFIG = (buildingId: bigint): EntityNamesTableConfig => ({
    namesTable: "core.core_map_building_names",
    fkColumn: "building_id",
    entityId: buildingId,
    myanmarWriteLanguageCode: "mm",
    myanmarScriptCode: "MYMR",
    englishScriptCode: "LATN",
});

export async function syncBuildingPrimaryNames(
    tx: DbClient,
    buildingId: bigint,
    slots: PrimaryNameSlots
): Promise<void> {
    await syncPrimaryOfficialNames(tx, BUILDING_NAMES_CONFIG(buildingId), slots);
}
