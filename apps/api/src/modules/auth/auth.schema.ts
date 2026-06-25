import { z } from "zod";

export const registerBodySchema = z.object({
    email: z.string().trim().email(),
    displayName: z.string().trim().min(2).max(120),
    password: z.string().min(8).max(200),
    // Optional UI preference; column already exists with a DB default of "my".
    preferredLanguage: z.enum(["my", "en"]).optional(),
    // Optional home region from the public region picker; validated against
    // core.core_admin_areas before persistence. TODO: phone on registration.
    primaryRegionId: z.number().int().positive().optional(),
});

export const loginBodySchema = z
    .object({
        email: z.string().trim().email().optional(),
        username: z.string().trim().min(3).optional(),
        password: z.string().min(6),
    })
    .superRefine((value, ctx) => {
        if (!value.email && !value.username) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Either email or username is required",
                path: ["email"],
            });
        }

        if (value.email && value.username) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide either email or username",
                path: ["username"],
            });
        }
    });

export const refreshBodySchema = z.object({
    refreshToken: z.string().min(1),
});

export const logoutBodySchema = z.object({
    refreshToken: z.string().min(1),
});

/** Minimal user shape for login/refresh responses. */
export const authUserSchema = z.object({
    id: z.string(),
    public_id: z.string().uuid(),
    email: z.string().email(),
    display_name: z.string(),
    roles: z.array(z.string()),
});

/** Full profile for /auth/me and registration. Never includes secrets. */
export const authProfileSchema = z.object({
    id: z.string(),
    public_id: z.string().uuid(),
    email: z.string().email(),
    display_name: z.string(),
    phone: z.string().nullable(),
    roles: z.array(z.string()),
    email_verified: z.boolean(),
    account_status: z.string(),
    primary_region_id: z.string().nullable(),
    preferred_language: z.string(),
    total_points: z.number().int(),
});

/**
 * Self-service profile edit. All fields optional; only provided keys change.
 * phone/primaryRegionId accept null to clear. At least one field is required.
 */
export const updateProfileBodySchema = z
    .object({
        displayName: z.string().trim().min(2).max(120).optional(),
        phone: z.string().trim().min(3).max(40).nullable().optional(),
        preferredLanguage: z.enum(["my", "en"]).optional(),
        primaryRegionId: z.number().int().positive().nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "Provide at least one field to update",
    });

export const sessionResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.string(),
    user: authUserSchema,
});

export const registerResponseSchema = z.object({
    message: z.literal("Account created"),
    user: authProfileSchema,
});

export const logoutResponseSchema = z.object({
    message: z.literal("Logged out"),
});

export const verifyEmailOtpBodySchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const emailOtpStatusResponseSchema = z.object({
    status: z.enum(["sent", "verified", "already_verified"]),
});
