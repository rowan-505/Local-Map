import { z } from "zod";

export const importTransportGtfsExportsListQuerySchema = z.object({
    scope: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ImportTransportGtfsExportsListQuery = z.infer<
    typeof importTransportGtfsExportsListQuerySchema
>;

export const importTransportGtfsExportIdParamsSchema = z.object({
    id: z.string().regex(/^\d+$/),
});

export const importTransportGtfsOtpBuildsListQuerySchema = z.object({
    export_build_id: z.coerce.number().int().positive().optional(),
    scope: z.string().trim().min(1).optional(),
    build_status: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ImportTransportGtfsOtpBuildsListQuery = z.infer<
    typeof importTransportGtfsOtpBuildsListQuerySchema
>;

export const postImportTransportGtfsExportBodySchema = z.object({
    scope: z.string().trim().min(1).optional().default("yangon_local_bus"),
    dry_run: z.boolean().optional().default(true),
});

export type PostImportTransportGtfsExportBody = z.infer<typeof postImportTransportGtfsExportBodySchema>;
