import { z } from "zod";

export const queryBooleanSchema = z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true");
