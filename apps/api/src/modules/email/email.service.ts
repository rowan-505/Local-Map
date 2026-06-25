import { Resend } from "resend";

import { getEmailEnv, type EmailEnvConfig } from "../../config/env.js";

/** Raised when an email-dependent feature is used but provider config is missing. */
export class EmailServiceNotConfiguredError extends Error {
    readonly statusCode = 503;

    constructor() {
        super("Email service is not configured");
        this.name = "EmailServiceNotConfiguredError";
    }
}

/** Raised when the provider rejects or fails to send a message. */
export class EmailSendError extends Error {
    readonly statusCode = 502;

    constructor(message: string) {
        super(message);
        this.name = "EmailSendError";
    }
}

export type EmailVerificationOtpMessage = {
    to: string;
    code: string;
    ttlMinutes: number;
};

/**
 * Internal email abstraction. Routes/services depend on this interface, never on
 * the provider SDK directly, so the provider can be swapped or stubbed.
 */
export interface EmailService {
    isConfigured(): boolean;
    sendEmailVerificationOtp(message: EmailVerificationOtpMessage): Promise<void>;
}

class ResendEmailService implements EmailService {
    private client: Resend | null = null;

    constructor(private readonly config: EmailEnvConfig) {}

    isConfigured(): boolean {
        return Boolean(this.config.resendApiKey && this.config.from);
    }

    private getClient(): Resend {
        if (!this.config.resendApiKey || !this.config.from) {
            throw new EmailServiceNotConfiguredError();
        }

        if (!this.client) {
            this.client = new Resend(this.config.resendApiKey);
        }

        return this.client;
    }

    async sendEmailVerificationOtp(message: EmailVerificationOtpMessage): Promise<void> {
        const client = this.getClient();

        // NOTE: never log `message.code`.
        const { error } = await client.emails.send({
            from: this.config.from!,
            to: message.to,
            subject: "Your CoreMap verification code",
            text: buildOtpText(message.code, message.ttlMinutes),
            html: buildOtpHtml(message.code, message.ttlMinutes),
        });

        if (error) {
            throw new EmailSendError(error.message ?? "Failed to send email");
        }
    }
}

function buildOtpText(code: string, ttlMinutes: number): string {
    return [
        "Your CoreMap email verification code is:",
        "",
        code,
        "",
        `This code expires in ${ttlMinutes} minutes. If you did not request it, you can ignore this email.`,
    ].join("\n");
}

function buildOtpHtml(code: string, ttlMinutes: number): string {
    return [
        '<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#111">',
        "<p>Your CoreMap email verification code is:</p>",
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${code}</p>`,
        `<p style="color:#555">This code expires in ${ttlMinutes} minutes. If you did not request it, you can ignore this email.</p>`,
        "</div>",
    ].join("");
}

let cachedEmailService: EmailService | null = null;

/** Returns the process-wide email service singleton built from validated env. */
export function createEmailService(): EmailService {
    if (!cachedEmailService) {
        cachedEmailService = new ResendEmailService(getEmailEnv());
    }

    return cachedEmailService;
}
