import type { Prisma, PrismaClient } from "@prisma/client";

export type AuthUserRecord = {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    password_hash: string;
    is_active: boolean;
    roles: string[];
};

type AuthUserWithRoles = Prisma.AuthUserGetPayload<{
    include: {
        userRoles: {
            include: {
                role: true;
            };
        };
    };
}>;

export class AuthRoleNotFoundError extends Error {
    constructor(roleCode: string) {
        super(`Role "${roleCode}" not found`);
        this.name = "AuthRoleNotFoundError";
    }
}

export class AuthRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
        const user = await this.prisma.authUser.findUnique({
            where: {
                email,
            },
            include: {
                userRoles: {
                    include: {
                        role: true,
                    },
                },
            },
        });

        return user ? mapAuthUser(user) : null;
    }

    async findUserByPublicId(publicId: string): Promise<AuthUserRecord | null> {
        const user = await this.prisma.authUser.findUnique({
            where: {
                publicId,
            },
            include: {
                userRoles: {
                    include: {
                        role: true,
                    },
                },
            },
        });

        return user ? mapAuthUser(user) : null;
    }

    async touchLastLogin(userId: bigint) {
        await this.prisma.authUser.update({
            where: {
                id: userId,
            },
            data: {
                lastLoginAt: new Date(),
            },
        });
    }

    async createUserWithRole(input: {
        email: string;
        displayName: string;
        passwordHash: string;
        roleCode: string;
    }): Promise<AuthUserRecord> {
        const user = await this.prisma.$transaction(async (tx) => {
            const role = await tx.authRole.findUnique({
                where: {
                    code: input.roleCode,
                },
            });

            if (!role) {
                throw new AuthRoleNotFoundError(input.roleCode);
            }

            const createdUser = await tx.authUser.create({
                data: {
                    email: input.email,
                    displayName: input.displayName,
                    passwordHash: input.passwordHash,
                    isActive: true,
                },
            });

            await tx.authUserRole.create({
                data: {
                    userId: createdUser.id,
                    roleId: role.id,
                },
            });

            return tx.authUser.findUniqueOrThrow({
                where: {
                    id: createdUser.id,
                },
                include: {
                    userRoles: {
                        include: {
                            role: true,
                        },
                    },
                },
            });
        });

        return mapAuthUser(user);
    }
}

function mapAuthUser(user: AuthUserWithRoles): AuthUserRecord {
    return {
        id: user.id.toString(),
        public_id: user.publicId,
        email: user.email,
        display_name: user.displayName,
        password_hash: user.passwordHash,
        is_active: user.isActive,
        roles: user.userRoles.map((userRole) => userRole.role.code),
    };
}
