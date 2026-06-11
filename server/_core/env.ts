function toBoolean(value: string | undefined, defaultValue = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function toStrictBooleanEnv(name: string, value: string | undefined, defaultValue = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  console.warn(`[Startup] Invalid boolean environment value for ${name}; expected true or false.`);
  return defaultValue;
}

function toPositiveInt(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.round(parsed);
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "admin",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  spacesKey: process.env.SPACES_KEY ?? "",
  spacesSecret: process.env.SPACES_SECRET ?? "",
  spacesBucket: process.env.SPACES_BUCKET ?? "",
  spacesRegion: process.env.SPACES_REGION ?? "",
  spacesEndpoint: process.env.SPACES_ENDPOINT ?? "",
  spacesCdn: process.env.SPACES_CDN ?? "",
  metubeBaseUrl: process.env.METUBE_BASE_URL ?? "",
  metubeInternalToken: process.env.METUBE_INTERNAL_TOKEN ?? "",
  metubeEnabled: toBoolean(process.env.METUBE_ENABLED, false),
  aiArtAgentEnabled: toStrictBooleanEnv("AI_ART_AGENT_ENABLED", process.env.AI_ART_AGENT_ENABLED, false),
  metubeYoutubeCookiesEnabled: toBoolean(process.env.METUBE_YOUTUBE_COOKIES_ENABLED, false),
  metubeOutputMount: process.env.METUBE_OUTPUT_MOUNT ?? "",
  metubePollTimeoutMs: toPositiveInt(process.env.METUBE_POLL_TIMEOUT_MS, 15000),
  metubePollIntervalMs: toPositiveInt(process.env.METUBE_POLL_INTERVAL_MS, 1500),
  videoOrphanGraceHours: toPositiveInt(process.env.VIDEO_ORPHAN_GRACE_HOURS, 72),
  supportNotificationEmail: process.env.SUPPORT_NOTIFICATION_EMAIL ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: toPositiveInt(process.env.SMTP_PORT, 587),
  smtpSecure: toBoolean(process.env.SMTP_SECURE, false),
  smtpFrom: process.env.SMTP_FROM ?? "",
  smtpUsername: process.env.SMTP_USERNAME ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
};

export function assertSpacesEnv(): void {
  const required: Array<[string, string]> = [
    ["SPACES_KEY", ENV.spacesKey],
    ["SPACES_SECRET", ENV.spacesSecret],
    ["SPACES_BUCKET", ENV.spacesBucket],
    ["SPACES_REGION", ENV.spacesRegion],
    ["SPACES_ENDPOINT", ENV.spacesEndpoint],
    ["SPACES_CDN", ENV.spacesCdn],
  ];

  const missing = required
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`[Startup] Missing required SPACES environment variables: ${missing.join(", ")}`);
  }
}
