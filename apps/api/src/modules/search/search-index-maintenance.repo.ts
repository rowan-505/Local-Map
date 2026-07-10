import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export const SEARCH_INDEX_AUDIT_ENTITY_TYPE = "search_index";

export type SearchIndexMaintenanceAuditContext = {
    actorUserId: bigint | null;
    ipAddress: string | null;
    userAgent: string | null;
};

export class SearchIndexMaintenanceRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT u.id
            FROM app_auth.auth_users u
            WHERE u.public_id = ${publicId}::uuid
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    async insertAudit(input: {
        actionType: string;
        entityId: bigint | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        audit: SearchIndexMaintenanceAuditContext;
    }): Promise<void> {
        const before =
            input.before === null
                ? Prisma.sql`NULL`
                : Prisma.sql`${JSON.stringify(input.before)}::jsonb`;
        const after =
            input.after === null
                ? Prisma.sql`NULL`
                : Prisma.sql`${JSON.stringify(input.after)}::jsonb`;

        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO system.audit_logs (
                actor_user_id,
                action_type,
                entity_type,
                entity_id,
                before_snapshot,
                after_snapshot,
                ip_address,
                user_agent
            )
            VALUES (
                ${input.audit.actorUserId},
                ${input.actionType},
                ${SEARCH_INDEX_AUDIT_ENTITY_TYPE},
                ${input.entityId},
                ${before},
                ${after},
                ${input.audit.ipAddress},
                ${input.audit.userAgent}
            )
        `);
    }
}
