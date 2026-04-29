import { Prisma } from "@prisma/client";
import { compare, hash } from "bcryptjs";

import { AuthRepository, AuthRoleNotFoundError } from "./auth.repo.js";

export class AuthError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "AuthError";
    }
}

type AuthUserResponse = {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    roles: string[];
};

export class AuthService {
    constructor(private readonly authRepo: AuthRepository) {}

    async login(
        credentials: {
            email?: string;
            username?: string;
        },
        password: string
    ) {
        const normalizedEmail = normalizeLoginEmail(credentials);
        const user = await this.authRepo.findUserByEmail(normalizedEmail);

        if (!user) {
            throw new AuthError("Invalid email or password", 401);
        }

        if (!user.is_active) {
            throw new AuthError("User account is inactive", 403);
        }

        const passwordMatches = await compare(password, user.password_hash);

        if (!passwordMatches) {
            throw new AuthError("Invalid email or password", 401);
        }

        await this.authRepo.touchLastLogin(BigInt(user.id));

        return {
            id: user.id,
            public_id: user.public_id,
            email: user.email,
            display_name: user.display_name,
            roles: user.roles,
        } satisfies AuthUserResponse;
    }

    async signupDemoAdmin(username: string, password: string) {
        const normalizedUsername = username.trim();
        const demoEmail = buildDemoEmail(normalizedUsername);
        const existingUser = await this.authRepo.findUserByEmail(demoEmail);

        if (existingUser) {
            throw new AuthError("Username already exists", 409);
        }

        const passwordHash = await hash(password, 10);

        try {
            const user = await this.authRepo.createUserWithRole({
                email: demoEmail,
                displayName: normalizedUsername,
                passwordHash,
                roleCode: "admin",
            });

            return {
                id: user.id,
                public_id: user.public_id,
                email: user.email,
                display_name: user.display_name,
                roles: user.roles,
            } satisfies AuthUserResponse;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new AuthError("Username already exists", 409);
            }

            if (error instanceof AuthRoleNotFoundError) {
                throw new AuthError("Admin role is not configured", 500);
            }

            throw error;
        }
    }

    async getMe(userPublicId: string) {
        const user = await this.authRepo.findUserByPublicId(userPublicId);

        if (!user) {
            throw new AuthError("User not found", 401);
        }

        if (!user.is_active) {
            throw new AuthError("User account is inactive", 403);
        }

        return {
            id: user.id,
            public_id: user.public_id,
            email: user.email,
            display_name: user.display_name,
            roles: user.roles,
        } satisfies AuthUserResponse;
    }
}

function normalizeLoginEmail(credentials: { email?: string; username?: string }) {
    if (credentials.username) {
        return buildDemoEmail(credentials.username);
    }

    return credentials.email!.trim().toLowerCase();
}

function buildDemoEmail(username: string) {
    return `${username.trim().toLowerCase()}@demo.local`;
}
