import { z } from "zod";

/** Profiles allowed in ROUTING_PUBLIC_PROFILES (must stay in sync with migration 060 seeds). */
const ROUTING_PUBLIC_PROFILE_ALLOWLIST = ["walk", "car", "motorcycle"] as const;

const routingEngineSchema = z.enum(["valhalla", "otp", "external"]);

const envBoolean = (defaultValue: boolean) =>
    z.preprocess(
        (value) => {
            if (value === undefined || value === "") {
                return defaultValue ? "true" : "false";
            }
            return value;
        },
        z.enum(["true", "false"], {
            error: "Expected \"true\" or \"false\"",
        })
    ).transform((value) => value === "true");

function parseCsvList(raw: string): string[] {
    return raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

const apiEnvSchema = z
    .object({
        PORT: z.coerce.number().int().min(1).max(65535).default(3001),
        ROUTING_ENABLED: envBoolean(false),
        ROUTING_DEFAULT_ENGINE: routingEngineSchema.default("valhalla"),
        VALHALLA_BASE_URL: z.string().url().default("http://localhost:8002"),
        ROUTING_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(8000),
        ROUTING_PUBLIC_PROFILES: z.string().default("walk,car,motorcycle"),
        RESEND_API_KEY: z.string().optional(),
        EMAIL_FROM: z.string().optional(),
        EMAIL_OTP_SECRET: z.string().optional(),
        EMAIL_OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
        EMAIL_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
        // Per-IP auth rate limiting. WINDOW is the shared time window (ms) applied to
        // all auth limits; MAX is the strict cap for POST /auth/login. The other auth
        // routes use fixed sensible multiples of these (see authRateLimit below).
        AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
        AUTH_RATE_LIMIT_WINDOW: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    })
    .transform((raw) => {
        const publicProfiles = parseCsvList(raw.ROUTING_PUBLIC_PROFILES);
        const allowlist = new Set<string>(ROUTING_PUBLIC_PROFILE_ALLOWLIST);

        for (const profile of publicProfiles) {
            if (!allowlist.has(profile)) {
                throw new Error(
                    `Invalid ROUTING_PUBLIC_PROFILES entry "${profile}". ` +
                        `Allowed: ${ROUTING_PUBLIC_PROFILE_ALLOWLIST.join(", ")}.`
                );
            }
        }

        if (publicProfiles.length === 0) {
            throw new Error("ROUTING_PUBLIC_PROFILES must list at least one profile.");
        }

        const valhallaBaseUrl = raw.VALHALLA_BASE_URL.replace(/\/+$/, "");

        return {
            port: raw.PORT,
            routing: {
                enabled: raw.ROUTING_ENABLED,
                defaultEngine: raw.ROUTING_DEFAULT_ENGINE,
                valhallaBaseUrl,
                requestTimeoutMs: raw.ROUTING_REQUEST_TIMEOUT_MS,
                publicProfiles: publicProfiles as (typeof ROUTING_PUBLIC_PROFILE_ALLOWLIST)[number][],
            },
            email: {
                resendApiKey: raw.RESEND_API_KEY?.trim() || null,
                from: raw.EMAIL_FROM?.trim() || null,
                otpSecret: raw.EMAIL_OTP_SECRET?.trim() || null,
                otpTtlMinutes: raw.EMAIL_OTP_TTL_MINUTES,
                otpMaxAttempts: raw.EMAIL_OTP_MAX_ATTEMPTS,
            },
            authRateLimit: {
                windowMs: raw.AUTH_RATE_LIMIT_WINDOW,
                login: raw.AUTH_RATE_LIMIT_MAX,
                register: 5,
                sendOtp: 3,
                refresh: 30,
            },
        };
    })
    .superRefine((config, ctx) => {
        if (!config.routing.enabled) {
            return;
        }
        if (config.routing.defaultEngine === "valhalla" && !config.routing.valhallaBaseUrl) {
            ctx.addIssue({
                code: "custom",
                message: "VALHALLA_BASE_URL is required when ROUTING_ENABLED=true and ROUTING_DEFAULT_ENGINE=valhalla.",
                path: ["VALHALLA_BASE_URL"],
            });
        }
    });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type RoutingEnvConfig = ApiEnv["routing"];
export type EmailEnvConfig = ApiEnv["email"];
export type AuthRateLimitConfig = ApiEnv["authRateLimit"];

let cachedEnv: ApiEnv | null = null;

/** @internal Test-only — clears cached parse between env test cases. */
export function resetApiEnvCacheForTests(): void {
    cachedEnv = null;
}

function formatEnvIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `  - ${path}: ${issue.message}`;
        })
        .join("\n");
}

/**
 * Parse and validate API environment variables. Call after dotenv loads (see server.ts).
 * Throws on invalid configuration so the process fails fast at startup.
 */
export function loadApiEnv(): ApiEnv {
    if (cachedEnv) {
        return cachedEnv;
    }

    const result = apiEnvSchema.safeParse(process.env);
    if (!result.success) {
        throw new Error(`Invalid API environment configuration:\n${formatEnvIssues(result.error)}`);
    }

    cachedEnv = result.data;
    return cachedEnv;
}

/** Validated env (loadApiEnv must run first in production startup). */
export function getApiEnv(): ApiEnv {
    if (!cachedEnv) {
        return loadApiEnv();
    }
    return cachedEnv;
}

export function getRoutingEnv(): RoutingEnvConfig {
    return getApiEnv().routing;
}

export function getEmailEnv(): EmailEnvConfig {
    return getApiEnv().email;
}

export function getAuthRateLimitEnv(): AuthRateLimitConfig {
    return getApiEnv().authRateLimit;
}

export function isRoutingEnabled(): boolean {
    return getRoutingEnv().enabled;
}

export function isRoutingProfilePublic(profile: string): boolean {
    return getRoutingEnv().publicProfiles.includes(
        profile as RoutingEnvConfig["publicProfiles"][number]
    );
}

/** For future POST /routing/route when ROUTING_ENABLED=false → HTTP 503. */
export function assertRoutingServiceEnabled(): void {
    if (!isRoutingEnabled()) {
        throw new RoutingServiceDisabledError();
    }
}

export class RoutingServiceDisabledError extends Error {
    readonly statusCode = 503;

    constructor() {
        super("Routing is disabled. Set ROUTING_ENABLED=true to enable directions.");
        this.name = "RoutingServiceDisabledError";
    }
}
