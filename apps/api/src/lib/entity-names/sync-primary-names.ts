import { Prisma, type PrismaClient } from "@prisma/client";

import {
    ENGLISH_LANGUAGE_CODE,
    MYANMAR_LANGUAGE_CODE,
    trimName,
} from "./derive-display-name.js";

export type PrimaryNameSlots = {
    /** Omit key to leave that language unchanged; null clears primary official row(s). */
    name_mm?: string | null | undefined;
    name_en?: string | null | undefined;
};

export type EntityNamesTableConfig = {
    namesTable: string;
    fkColumn: string;
    entityId: bigint;
    myanmarScriptCode: string;
    englishScriptCode: string;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

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
        scriptCode: string | null;
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
            Prisma.sql`(lower(trim(n.language_code)) = ${MYANMAR_LANGUAGE_CODE} OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR')`
        );
        const mm = trimName(slots.name_mm);
        if (mm) {
            await insertPrimaryOfficial(tx, config, {
                languageCode: MYANMAR_LANGUAGE_CODE,
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
    namesTable: "core.core_building_names",
    fkColumn: "building_id",
    entityId: buildingId,
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

export const LAND_AREA_NAMES_CONFIG = (landAreaId: bigint): EntityNamesTableConfig => ({
    namesTable: "core.core_land_area_names",
    fkColumn: "land_area_id",
    entityId: landAreaId,
    myanmarScriptCode: "MYMR",
    englishScriptCode: "LATN",
});

export type LandAreaFeatureNameSlots = PrimaryNameSlots & {
    name_und?: string | null | undefined;
};

export type MapFeatureNameSlots = LandAreaFeatureNameSlots;

async function syncUndPrimaryName(
    tx: DbClient,
    config: EntityNamesTableConfig,
    value: string | null | undefined
): Promise<void> {
    if (value === undefined) return;

    await clearPrimaryOfficial(tx, config, Prisma.sql`lower(trim(n.language_code)) = 'und'`);
    const und = trimName(value);
    if (und) {
        await insertPrimaryOfficial(tx, config, {
            languageCode: "und",
            scriptCode: null,
            name: und,
            searchWeight: 80,
        });
    }
}

/** Upserts primary official my/en/und feature names for one land area polygon. */
export const ADMIN_AREA_NAMES_CONFIG = (adminAreaId: bigint): EntityNamesTableConfig => ({
    namesTable: "core.core_admin_area_names",
    fkColumn: "admin_area_id",
    entityId: adminAreaId,
    myanmarScriptCode: "MYMR",
    englishScriptCode: "LATN",
});

export async function syncAdminAreaPrimaryNames(
    tx: DbClient,
    adminAreaId: bigint,
    slots: PrimaryNameSlots
): Promise<void> {
    await syncPrimaryOfficialNames(tx, ADMIN_AREA_NAMES_CONFIG(adminAreaId), slots);
}

export async function syncLandAreaFeatureNames(
    tx: DbClient,
    landAreaId: bigint,
    slots: LandAreaFeatureNameSlots
): Promise<void> {
    await syncPrimaryOfficialNames(tx, LAND_AREA_NAMES_CONFIG(landAreaId), {
        name_mm: slots.name_mm,
        name_en: slots.name_en,
    });

    await syncUndPrimaryName(tx, LAND_AREA_NAMES_CONFIG(landAreaId), slots.name_und);
}

function waterNamesConfig(entityFamily: "water_lines" | "water_polygons", entityId: bigint) {
    return entityFamily === "water_lines"
        ? {
              namesTable: "core.core_water_line_names",
              fkColumn: "water_line_id",
              entityId,
              myanmarScriptCode: "MYMR",
              englishScriptCode: "LATN",
          }
        : {
              namesTable: "core.core_water_polygon_names",
              fkColumn: "water_polygon_id",
              entityId,
              myanmarScriptCode: "MYMR",
              englishScriptCode: "LATN",
          };
}

export async function syncWaterFeatureNames(
    tx: DbClient,
    entityFamily: "water_lines" | "water_polygons",
    entityId: bigint,
    slots: MapFeatureNameSlots
): Promise<void> {
    const config = waterNamesConfig(entityFamily, entityId);
    await syncPrimaryOfficialNames(tx, config, slots);
    await syncUndPrimaryName(tx, config, slots.name_und);
}
