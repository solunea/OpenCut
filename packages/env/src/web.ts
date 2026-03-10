import { z } from "zod";

const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

const buildTimeEnv = {
  ...process.env,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_MARBLE_API_URL: "https://api.marblecms.com",
  DATABASE_URL: "postgresql://opencut:opencut@localhost:5432/opencut",
  BETTER_AUTH_SECRET: "build-time-secret",
  UPSTASH_REDIS_REST_URL: "https://example.com",
  UPSTASH_REDIS_REST_TOKEN: "build-time-token",
  MARBLE_WORKSPACE_KEY: "build-placeholder",
  FREESOUND_CLIENT_ID: "build-placeholder",
  FREESOUND_API_KEY: "build-placeholder",
  CLOUDFLARE_ACCOUNT_ID: "build-placeholder",
  R2_ACCESS_KEY_ID: "build-placeholder",
  R2_SECRET_ACCESS_KEY: "build-placeholder",
  R2_BUCKET_NAME: "build-placeholder",
  MODAL_TRANSCRIPTION_URL: "https://example.com",
};

const webEnvSchema = z.object({
  // Node
  NODE_ENV: z.enum(["development", "production", "test"]),
  ANALYZE: z.string().optional(),
  NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

  // Public
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_MARBLE_API_URL: z.url(),

  // Server
  DATABASE_URL: z
    .string()
    .startsWith("postgres://")
    .or(z.string().startsWith("postgresql://")),

  BETTER_AUTH_SECRET: z.string(),
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string(),
  MARBLE_WORKSPACE_KEY: z.string(),
  FREESOUND_CLIENT_ID: z.string(),
  FREESOUND_API_KEY: z.string(),
  CLOUDFLARE_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET_NAME: z.string(),
  MODAL_TRANSCRIPTION_URL: z.url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse(
  isProductionBuild ? buildTimeEnv : process.env
);
