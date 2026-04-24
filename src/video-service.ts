import ytdlp from "yt-dlp-exec";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

// ──────────────────────────────
//  Configuration
// ──────────────────────────────

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "./downloads";

// ──────────────────────────────
//  Types
// ──────────────────────────────

interface YtDlpFormat {
  format_id: string;
  resolution: string | null;
  height: number | null;
  format_note: string | null;
  ext: string;
  filesize: number | null;
  filesize_approx: number | null;
  vcodec: string;
  acodec: string;
}

interface YtDlpInfo {
  title: string;
  thumbnail: string;
  duration: number;
  formats: YtDlpFormat[];
}

export interface VideoFormat {
  format_id: string;
  resolution: string;
  quality: string;
  ext: string;
  filesize: number;
  vcodec: string;
  acodec: string;
}

export interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  formats: VideoFormat[];
}

export interface DownloadResult {
  filePath: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
}

// ──────────────────────────────
//  Helpers
// ──────────────────────────────

/**
 * Determines the appropriate Referer header based on the URL domain.
 * This helps yt-dlp bypass basic bot detection.
 */
function getReferer(url: string): string {
  if (url.includes("twitter.com") || url.includes("x.com")) {
    return "https://x.com/";
  }
  if (url.includes("facebook.com") || url.includes("fb.watch")) {
    return "https://www.facebook.com/";
  }
  if (url.includes("instagram.com")) {
    return "https://www.instagram.com/";
  }
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    return "https://www.youtube.com/";
  }
  return "https://www.google.com/";
}

/**
 * Builds the shared options object for yt-dlp-exec calls.
 * These headers and flags apply to both metadata fetching and downloading.
 */
function buildBaseOptions(url: string): Record<string, unknown> {
  return {
    noCheckCertificates: true,
    noWarnings: true,
    noPlaylist: true,
    youtubeSkipDashManifest: true,
    // Forces yt-dlp to try multiple client types, improving reliability
    extractorArgs: "youtube:player_client=android,ios,web",
    addHeader: [
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language: en-US,en;q=0.9",
      `Referer: ${getReferer(url)}`,
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    ],
  };
}

/**
 * Resolves the format string for yt-dlp based on user preferences.
 * 
 * @param formatId - Raw format ID from the client (can be null, "best", "137", "137+bestaudio", etc.)
 * @param audioOnly - Whether to extract only audio
 */
function resolveFormat(formatId: string | null, audioOnly: boolean): string {
  if (audioOnly) {
    return "bestaudio/best";
  }
  if (!formatId || formatId === "best") {
    return "bestvideo+bestaudio/best";
  }
  // If the client already sent a complex format string, use it as-is
  if (formatId.includes("+") || formatId.includes("/")) {
    return formatId;
  }
  // Specific video-only ID: merge with best audio
  return `${formatId}+bestaudio/${formatId}`;
}

/**
 * Generates a unique ID for the filename to avoid collisions.
 * Format: timestamp + random alphanumeric
 */
function generateUid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

// ──────────────────────────────
//  Public API
// ──────────────────────────────

/**
 * Fetches video metadata and available formats without downloading the video.
 * Useful for displaying format options in the UI before the user chooses.
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const raw = (await ytdlp(url, {
    ...buildBaseOptions(url),
    dumpSingleJson: true,
  })) as unknown as YtDlpInfo;

  const formats: VideoFormat[] = (raw.formats || [])
    .filter((f) => f.vcodec !== "none" || f.acodec !== "none")
    .map((f) => ({
      format_id: f.format_id,
      resolution: f.resolution || (f.height ? `${f.height}p` : "audio"),
      quality: f.format_note || f.resolution || "Standard",
      ext: f.ext,
      filesize: f.filesize || f.filesize_approx || 0,
      vcodec: f.vcodec,
      acodec: f.acodec,
    }))
    .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))
    .slice(0, 10);

  return {
    title: raw.title,
    thumbnail: raw.thumbnail,
    duration: raw.duration,
    formats,
  };
}

/**
 * Downloads a media file from a URL using yt-dlp.
 * This is the core function of the extraction worker.
 * 
 * @param url       - YouTube, Instagram, X, or other supported URL
 * @param formatId  - Specific format ID or complex format string
 * @param audioOnly - If true, download and convert to MP3 audio only
 * @returns Metadata about the downloaded file
 */
export async function downloadMedia(
  url: string,
  formatId: string | null = null,
  audioOnly: boolean = false
): Promise<DownloadResult> {
  // Ensure the download directory exists
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

  const uid = generateUid();
  const outputTemplate = path.join(DOWNLOAD_DIR, `%(title)s_[${uid}].%(ext)s`);
  const format = resolveFormat(formatId, audioOnly);

  // Base options shared with getVideoInfo
  const options: Record<string, unknown> = {
    ...buildBaseOptions(url),
    output: outputTemplate,
    format,
  };

  // Audio-only mode: tells yt-dlp to extract audio and convert to MP3
  if (audioOnly) {
    options.extractAudio = true;
    options.audioFormat = "mp3";
  }

  console.log(`[yt-dlp] Starting download: ${url}`);
  console.log(`[yt-dlp] Format: ${format}, Audio only: ${audioOnly}`);

  // Execute the download via yt-dlp-exec
  await ytdlp(url, options);

  // Small delay to ensure the OS has finished writing the file
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Find the downloaded file by its unique ID
  const files = await fs.readdir(DOWNLOAD_DIR);
  const match = files.find(
    (f) =>
      f.includes(`[${uid}]`) &&
      !f.endsWith(".part") &&
      !f.endsWith(".ytdl") &&
      !f.endsWith(".tmp")
  );

  if (!match) {
    console.error(`[yt-dlp] Downloaded file not found. Directory contents:`, files);
    throw new Error("Downloaded file not found on disk. Check yt-dlp output.");
  }

  const filePath = path.join(DOWNLOAD_DIR, match);
  const stat = await fs.stat(filePath);

  if (stat.size === 0) {
    await fs.unlink(filePath).catch(() => {});
    throw new Error("Downloaded file is empty (0 bytes). The source may be unavailable.");
  }

  console.log(`[yt-dlp] Download complete: ${match} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

  return {
    filePath,
    filename: match,
    // Strip the unique ID from the output filename for a cleaner user-facing name
    originalFilename: match.replace(/_\s*\[.*?\]/, ""),
    mimeType: audioOnly ? "audio/mp3" : "video/mp4",
  };
}
