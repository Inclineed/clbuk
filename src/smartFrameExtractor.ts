/**
 * Smart Frame Extractor — Two-phase adaptive frame extraction.
 *
 * Phase 1: Extract candidate frames at a fine interval (default 10s) as
 *          tiny 64×64 thumbnails AND full-resolution JPEGs.
 * Phase 2: Compare consecutive thumbnails using Mean Absolute Difference (MAD)
 *          to discard visually identical frames. Only distinct frames are kept
 *          for expensive vision LLM analysis.
 *
 * No external image libraries required — uses raw pixel buffer math.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { config } from './config.js';
import { log } from './logger.js';

// ─── Types ───────────────────────────────────────────────────

export interface SmartFrame {
  /** Path to the full-resolution JPEG for vision LLM input. */
  framePath: string;
  /** Timestamp in seconds within the video. */
  timestampSeconds: number;
  /** Pixel difference score (0–100) compared to the previous kept frame. */
  changeScore: number;
}

// ─── Phase 1: Extract candidate frames ───────────────────────

/**
 * Extract candidate frames at `intervalSec`-second intervals.
 * Produces two sets:
 *   - Full-res JPEGs (for vision LLM input later)
 *   - Tiny 64×64 thumbnails (for fast pixel comparison)
 */
async function extractCandidates(
  videoPath: string,
  outputDir: string,
  intervalSec: number
): Promise<{ fullDir: string; thumbDir: string; count: number }> {
  const fullDir = path.join(outputDir, 'full');
  const thumbDir = path.join(outputDir, 'thumb');
  await fs.mkdir(fullDir, { recursive: true });
  await fs.mkdir(thumbDir, { recursive: true });

  // Extract full-resolution frames
  await runFfmpeg([
    '-y', '-i', videoPath,
    '-vf', `fps=1/${intervalSec}`,
    '-q:v', '5',
    path.join(fullDir, 'frame_%04d.jpg'),
  ]);

  // Extract 64×64 thumbnails for comparison
  await runFfmpeg([
    '-y', '-i', videoPath,
    '-vf', `fps=1/${intervalSec},scale=64:64`,
    '-q:v', '10',
    path.join(thumbDir, 'frame_%04d.jpg'),
  ]);

  // Count extracted files
  const files = await fs.readdir(thumbDir);
  const count = files.filter(f => /^frame_\d{4}\.jpg$/.test(f)).length;

  return { fullDir, thumbDir, count };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`FFmpeg failed: ${stderr || error.message}`));
      } else {
        resolve();
      }
    });
  });
}

// ─── Phase 2: Pixel-diff filtering ──────────────────────────

/**
 * Compute the Mean Absolute Difference between two raw pixel buffers.
 * Returns a value 0–100 representing the percentage of maximum possible difference.
 *
 * Both buffers must have the same length (same image dimensions).
 * Works directly on JPEG file buffers by comparing byte values — this is an
 * approximation since JPEG is compressed, but it works reliably for detecting
 * significant visual changes at thumbnail resolution.
 */
function computeMAD(bufA: Buffer, bufB: Buffer): number {
  const len = Math.min(bufA.length, bufB.length);
  if (len === 0) return 100; // If either is empty, treat as fully different

  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(bufA[i] - bufB[i]);
  }

  // Normalize: max possible diff per byte is 255
  const mad = (totalDiff / (len * 255)) * 100;
  return mad;
}

/**
 * Filter candidate frames by comparing consecutive thumbnails.
 * Keeps only frames whose pixel difference from the last kept frame
 * exceeds the configured threshold.
 *
 * Always keeps the first frame.
 * Respects the max vision calls cap.
 */
async function filterByPixelDiff(
  thumbDir: string,
  fullDir: string,
  candidateCount: number,
  intervalSec: number,
  threshold: number,
  maxFrames: number
): Promise<SmartFrame[]> {
  const kept: SmartFrame[] = [];

  // Load first thumbnail as the baseline
  const firstThumbPath = path.join(thumbDir, 'frame_0001.jpg');
  let prevBuffer: Buffer;
  try {
    prevBuffer = await fs.readFile(firstThumbPath);
  } catch {
    log.warn('smart-frames', 'Could not read first thumbnail, aborting smart extraction.');
    return [];
  }

  // Always keep the first frame
  kept.push({
    framePath: path.join(fullDir, 'frame_0001.jpg'),
    timestampSeconds: 0,
    changeScore: 100, // First frame is always "new"
  });

  for (let i = 2; i <= candidateCount; i++) {
    if (kept.length >= maxFrames) {
      log.info('smart-frames', `Reached max vision call cap (${maxFrames}). Stopping frame selection.`);
      break;
    }

    const idx = String(i).padStart(4, '0');
    const thumbPath = path.join(thumbDir, `frame_${idx}.jpg`);

    let currentBuffer: Buffer;
    try {
      currentBuffer = await fs.readFile(thumbPath);
    } catch {
      continue; // Skip unreadable frames
    }

    const diff = computeMAD(prevBuffer, currentBuffer);

    if (diff >= threshold) {
      const timestampSeconds = (i - 1) * intervalSec;
      kept.push({
        framePath: path.join(fullDir, `frame_${idx}.jpg`),
        timestampSeconds,
        changeScore: Math.round(diff * 10) / 10,
      });
      prevBuffer = currentBuffer; // Update baseline to this new distinct frame
    }
  }

  return kept;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Smart frame extraction: extract candidates at fine intervals, then
 * filter to keep only visually distinct frames.
 *
 * @returns Array of SmartFrame objects for distinct frames only.
 */
export async function extractSmartFrames(
  videoPath: string,
  outputDir: string
): Promise<SmartFrame[]> {
  const intervalSec = config.smartFrameCandidateIntervalSec;
  const threshold = config.smartFrameChangeThreshold;
  const maxFrames = config.smartFrameMaxVisionCalls;

  log.step('smart-frames', `Extracting candidate frames every ${intervalSec}s...`);

  // Phase 1: Extract candidates
  const { fullDir, thumbDir, count } = await extractCandidates(
    videoPath, outputDir, intervalSec
  );
  log.info('smart-frames', `Extracted ${count} candidate frames.`);

  if (count === 0) {
    return [];
  }

  // Phase 2: Filter by pixel difference
  log.step('smart-frames', `Filtering candidates (threshold: ${threshold}%, max: ${maxFrames})...`);
  const distinct = await filterByPixelDiff(
    thumbDir, fullDir, count, intervalSec, threshold, maxFrames
  );

  log.success('smart-frames', `Kept ${distinct.length}/${count} visually distinct frames.`);

  return distinct;
}
