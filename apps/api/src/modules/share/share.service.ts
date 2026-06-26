import { randomInt } from "node:crypto";

import { Prisma } from "@prisma/client";

import { ShareRepository, type InsertShareLinkInput } from "./share.repo.js";
import { SHARE_CODE_ALPHABET, type CreateShareLinkBody } from "./share.schema.js";
import type {
    CreateShareLinkResult,
    ResolvedShareLink,
    ShareLinkRow,
} from "./share.types.js";

export class ShareError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "ShareError";
    }
}

const DEFAULT_CODE_LENGTH = 7;
const MAX_INSERT_ATTEMPTS = 6;

export class ShareService {
    constructor(
        private readonly repo: ShareRepository,
        private readonly baseUrl: string,
    ) {}

    async create(body: CreateShareLinkBody): Promise<CreateShareLinkResult> {
        // Dedup: reuse an existing share for the same target instead of minting a new code.
        const existing = await this.findDuplicate(body);
        if (existing) {
            return this.toCreateResult(existing.code);
        }

        if (body.target_type === "place") {
            const exists = await this.repo.placeExists(body.place_public_id);
            if (!exists) {
                throw new ShareError("Place not found", 404);
            }
        }

        const insertBase = this.toInsertBase(body);

        for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
            const code = generateShareCode(DEFAULT_CODE_LENGTH);
            try {
                const row = await this.repo.insert({ ...insertBase, code });
                return this.toCreateResult(row.code);
            } catch (error) {
                if (!isUniqueViolation(error)) {
                    throw error;
                }

                // A concurrent request may have created the same target — reuse it.
                const duplicate = await this.findDuplicate(body);
                if (duplicate) {
                    return this.toCreateResult(duplicate.code);
                }
                // Otherwise it was a code collision: loop and try a fresh code.
            }
        }

        throw new ShareError("Could not generate a unique share code", 500);
    }

    async resolve(code: string): Promise<ResolvedShareLink> {
        const row = await this.repo.findByCode(code);
        if (!row) {
            throw new ShareError("Share link not found", 404);
        }

        // Fire-and-forget access tracking; never block or fail the resolve on error.
        void this.repo.recordAccess(code).catch(() => undefined);

        return toResolvedShareLink(row);
    }

    private async findDuplicate(body: CreateShareLinkBody): Promise<ShareLinkRow | null> {
        if (body.target_type === "place") {
            return this.repo.findPlaceShare(body.place_public_id);
        }
        return this.repo.findPointShare(
            roundCoord(body.lat),
            roundCoord(body.lng),
            body.zoom ?? null,
        );
    }

    private toInsertBase(body: CreateShareLinkBody): Omit<InsertShareLinkInput, "code"> {
        if (body.target_type === "place") {
            return {
                targetType: "place",
                placePublicId: body.place_public_id,
                lat: null,
                lng: null,
                zoom: null,
                addressLine: null,
                plusCode: null,
            };
        }

        return {
            targetType: "point",
            placePublicId: null,
            lat: roundCoord(body.lat),
            lng: roundCoord(body.lng),
            zoom: body.zoom ?? null,
            addressLine: body.address_line?.trim() || null,
            plusCode: body.plus_code?.trim() || null,
        };
    }

    private toCreateResult(code: string): CreateShareLinkResult {
        return { code, url: `${this.baseUrl}/s/${code}` };
    }
}

/** Rounds a coordinate to 6 decimal places (~0.1m), the stored snapshot precision. */
function roundCoord(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

export function generateShareCode(length: number): string {
    let code = "";
    for (let index = 0; index < length; index += 1) {
        code += SHARE_CODE_ALPHABET[randomInt(SHARE_CODE_ALPHABET.length)];
    }
    return code;
}

function toResolvedShareLink(row: ShareLinkRow): ResolvedShareLink {
    if (row.target_type === "place") {
        if (!row.place_public_id) {
            // Enforced by the DB CHECK; defensive guard for unexpected data.
            throw new ShareError("Share link is missing its place reference", 500);
        }
        return { target_type: "place", place_public_id: row.place_public_id };
    }

    return {
        target_type: "point",
        lat: row.lat as number,
        lng: row.lng as number,
        zoom: row.zoom,
        address_line: row.address_line,
        plus_code: row.plus_code,
    };
}

/** Detects a Postgres unique violation across both Prisma and raw-query error shapes. */
function isUniqueViolation(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            return true;
        }
        if (error.code === "P2010") {
            const meta = error.meta as { code?: string } | undefined;
            if (meta?.code === "23505") {
                return true;
            }
            return /23505|unique constraint|duplicate key/i.test(error.message);
        }
    }
    return false;
}
