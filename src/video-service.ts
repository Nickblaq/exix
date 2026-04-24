
import youtubedl from "youtube-dl-exec";
import path from "path";
import fs from "fs/promises";

// Railway mounts a persistent volume here for data that survives restarts [citation:2]
// Use environment variable so it's configurable, with a sensible default
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "./downloads";

export interface DownloadResult {
  filePath: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
}

function buildBaseOptions(url: string) {
  // ... (your existing referer and header logic is perfect here) ...
}

export async function downloadMedia(
  url: string,
  formatId: string | null = null,
  audioOnly: boolean = false
): Promise<DownloadResult> {
  // Ensure download directory exists (on the persistent volume)
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  
  const uid = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const outputTemplate = path.join(DOWNLOAD_DIR, `%(title)s_[${uid}].%(ext)s`);

  // ... (your existing format resolution and youtube-dl-exec call is perfect here) ...

  // Wait a moment for the file system to settle
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Find the freshly downloaded file
  const files = await fs.readdir(DOWNLOAD_DIR);
  const match = files.find(
    (f) =>
      f.includes(`[${uid}]`) &&
      !f.endsWith(".part") &&
      !f.endsWith(".ytdl") &&
      !f.endsWith(".tmp")
  );

  if (!match) throw new Error("Downloaded file not found");

  return {
    filePath: path.join(DOWNLOAD_DIR, match),
    filename: match,
    originalFilename: match.replace(/_\s*\[.*?\]/, ""),
    mimeType: audioOnly ? "audio/mp3" : "video/mp4",
  };
}
