// Locating and running external command-line tools (yt-dlp, ffmpeg, ffprobe).
// We always use execFile (no shell), so URLs can never be interpreted as commands.

import { execFile } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 5 * 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { stderr?: string; code?: string | number };
          e.stderr = String(stderr ?? "");
          reject(e);
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}

export const tools = {
  ytdlp: () => process.env.YTDLP_PATH || "yt-dlp",
  ffmpeg: () => process.env.FFMPEG_PATH || "ffmpeg",
  ffprobe: () => process.env.FFPROBE_PATH || "ffprobe",
};

/** Returns the tool's version string, or null when it is not installed. */
export async function toolVersion(cmd: string, versionArg: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(cmd, [versionArg], { timeoutMs: 15_000 });
    return (stdout || stderr).split("\n")[0].trim();
  } catch {
    return null;
  }
}

export interface ProbeInfo {
  durationSec: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

export async function probeVideo(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(tools.ffprobe(), [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json",
    file,
  ], { timeoutMs: 60_000 });
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video) throw new Error("Dit bestand bevat geen videobeeld.");
  return {
    durationSec: Math.round(Number(data.format?.duration ?? 0) * 10) / 10,
    width: video.width,
    height: video.height,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
  };
}
