import { z } from "zod";

/**
 * URL-safe code alphabet. Excludes visually confusing characters
 * (0 O I l 1) so codes are easy to read and re-type.
 */
export const SHARE_CODE_ALPHABET =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Codes are 6–8 characters drawn from the alphabet above. */
export const SHARE_CODE_REGEX = new RegExp(`^[${SHARE_CODE_ALPHABET}]{6,8}$`);

export const shareCodeParamSchema = z.object({
    code: z.string().trim().regex(SHARE_CODE_REGEX, "Invalid share code"),
});

/**
 * Create payload. Two target types:
 *  - point: an arbitrary map location (lat/lng required; zoom/address/plus_code
 *           are an optional snapshot stored for fast resolve).
 *  - place: a core place referenced by its public uuid.
 */
export const createShareLinkBodySchema = z.discriminatedUnion("target_type", [
    z.object({
        target_type: z.literal("point"),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        zoom: z.number().min(0).max(24).optional(),
        address_line: z.string().trim().max(500).optional(),
        plus_code: z.string().trim().max(60).optional(),
    }),
    z.object({
        target_type: z.literal("place"),
        place_public_id: z.string().trim().uuid(),
    }),
]);

export type CreateShareLinkBody = z.infer<typeof createShareLinkBodySchema>;
