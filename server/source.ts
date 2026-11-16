// Helpers for describing where a video came from (platform, account, date).
// Pure functions only, so they are easy to test.

export type Platform = "tiktok" | "instagram" | "youtube" | "x" | "other";

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  other: "Anders",
};

export function detectPlatform(rawUrl: string): Platform {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\.|^m\./, "");
  } catch {
    return "other";
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) return "x";
  return "other";
}

export function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Normalise an account name to "@handle" form (no spaces, single @). */
export function normalizeAccount(raw: string | undefined | null): string {
  if (!raw) return "";
  const trimmed = String(raw).trim().replace(/^@+/, "");
  if (!trimmed) return "";
  // Display names with spaces are not handles; keep them as-is.
  if (/\s/.test(trimmed)) return trimmed;
  return "@" + trimmed;
}

/** Try to read the account handle from the URL itself (TikTok/X/YouTube). */
export function accountFromUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "";
  }
  const parts = u.pathname.split("/").filter(Boolean);
  const platform = detectPlatform(rawUrl);
  if (platform === "tiktok" || platform === "youtube") {
    const handle = parts.find((p) => p.startsWith("@"));
    return handle ? normalizeAccount(handle) : "";
  }
  if (platform === "x" && parts.length >= 3 && parts[1] === "status") {
    return normalizeAccount(parts[0]);
  }
  return "";
}

/** yt-dlp gives dates as "YYYYMMDD"; convert to ISO "YYYY-MM-DD". */
export function ytdlpDateToIso(raw: string | undefined | null): string {
  if (!raw || !/^\d{8}$/.test(raw)) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function isIsoDate(raw: string | undefined | null): boolean {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(raw + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(raw);
}

/** Short, filesystem-safe name: lowercase, a-z0-9 and dashes, max ~40 chars. */
export function slugify(text: string, maxLen = 40): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || "video";
}

/** Local date as YYYY-MM-DD (job folders use the creation day on this laptop). */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
