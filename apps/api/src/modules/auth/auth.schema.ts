import { z } from "zod";

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

export const signupBodySchema = z.object({
    username: z.string().trim().min(3),
    password: z.string().min(6),
});

export const authUserSchema = z.object({
    id: z.string(),
    public_id: z.string().uuid(),
    email: z.string().email(),
    display_name: z.string(),
    roles: z.array(z.string()),
});

export const loginResponseSchema = z.object({
    accessToken: z.string(),
    user: authUserSchema,
});

export const signupResponseSchema = z.object({
    message: z.literal("Demo admin account created"),
    user: authUserSchema,
});
