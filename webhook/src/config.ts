import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  META_ACCESS_TOKEN: z.string().min(1, "META_ACCESS_TOKEN is required"),
  META_PHONE_NUMBER_ID: z.string().min(1, "META_PHONE_NUMBER_ID is required"),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1, "WEBHOOK_VERIFY_TOKEN is required"),
  META_APP_SECRET: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  PORT: z.coerce.number().default(3000),
});

function loadEnv(): z.infer<typeof envSchema> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(__dirname, "../.env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found, rely on process.env
  }

  return envSchema.parse(process.env);
}

export const config = loadEnv();
