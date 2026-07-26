/**
 * Visual Event Detector — Streaming semantic visual analysis.
 *
 * Uses `ffmpeg -f image2pipe` to stream thumbnails directly to memory without
 * touching disk. Implements an adaptive SCANNING/TRACKING state machine that
 * only tracks closely if a semantic *educational* change is detected.
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { config } from './config.js';
import { log } from './logger.js';
import { classifyVisualEvent } from './visionAnalyzer.js';

// ─── Types ───────────────────────────────────────────────────

export type VisualEventType =
  | 'SLIDE_CHANGED'
  | 'WHITEBOARD_UPDATED'
  | 'DIAGRAM_EXTENDED'
  | 'CODE_MODIFIED'
  | 'TEACHER_WRITING'
  | 'TEACHER_STOPPED_WRITING'
  | 'SCREEN_SHARE_STARTED'
  | 'SCREEN_SHARE_ENDED'
  | 'IDLE_VISUAL'
  | 'OTHER';

export interface VisualEvent {
  timestampSeconds: number;
  eventType: VisualEventType;
  description: string;
  changeScore: number;
  visibleContent?: string;
  framePath: string;
}

type ScanState = 'SCANNING' | 'TRACKING';

// ─── FFmpeg Helpers ──────────────────────────────────────────

/** Extract a single full-resolution frame at a specific timestamp. */
async function extractSingleFrame(
  videoPath: string,
  timestampSeconds: number,
  outputPath: string
): Promise<void> {
  const hours = Math.floor(timestampSeconds / 3600);
  const minutes = Math.floor((timestampSeconds % 3600) / 60);
  const seconds = timestampSeconds % 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-y',
      '-ss', timeStr,
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '5',
      outputPath,
    ]);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with ${code}`));
    });
    p.on('error', reject);
  });
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Pixel & OCR Diff ───────────────────────────────────────

function computeMAD(bufA: Buffer, bufB: Buffer): number {
  const len = Math.min(bufA.length, bufB.length);
  if (len === 0) return 100;

  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(bufA[i] - bufB[i]);
  }
  return (totalDiff / (len * 255)) * 100;
}

async function hasTextChanged(framePath1: string, framePath2: string): Promise<boolean> {
  try {
    const Tesseract = await import('tesseract.js');
    const [result1, result2] = await Promise.all([
      Tesseract.default.recognize(framePath1, 'eng', { logger: () => {} }),
      Tesseract.default.recognize(framePath2, 'eng', { logger: () => {} }),
    ]);

    const text1 = (result1.data.text || '').trim().toLowerCase();
    const text2 = (result2.data.text || '').trim().toLowerCase();

    if (!text1 && !text2) return false;
    if (!text1 || !text2) return true;

    const longer = Math.max(text1.length, text2.length);
    let diffs = 0;
    for (let i = 0; i < longer; i++) {
      if ((text1[i] || '') !== (text2[i] || '')) diffs++;
    }
    return (diffs / longer) > 0.15;
  } catch (err: any) {
    log.warn('visual-ocr', `OCR comparison failed: ${err.message}`);
    return false;
  }
}

// ─── Semantic Streaming ───────────────────────────────────────

const EDUCATIONAL_EVENTS = new Set([
  'SLIDE_CHANGED', 'WHITEBOARD_UPDATED', 'DIAGRAM_EXTENDED',
  'CODE_MODIFIED', 'TEACHER_WRITING'
]);

/**
 * Detect visual events using streaming thumbnails and semantic interleaved classification.
 */
export async function detectVisualChanges(
  videoPath: string,
  outputDir: string
): Promise<VisualEvent[]> {
  const intervalSec = config.visualThumbIntervalSec;
  const threshold = config.visualChangeThreshold;
  const maxEvents = config.visualMaxEvents;
  const scanStep = config.visualScanStep;
  const trackStability = config.visualTrackStability;
  const ocrEnabled = config.visualOcrEnabled;

  const borderlineLow = threshold * 0.4;
  
  await fs.mkdir(outputDir, { recursive: true });
  const fullDir = path.join(outputDir, 'full');
  await fs.mkdir(fullDir, { recursive: true });

  const events: VisualEvent[] = [];
  
  // State machine variables
  let state: ScanState = 'SCANNING';
  let stableCount = 0;
  let prevBuffer: Buffer | null = null;
  let prevKeptFullPath: string | null = null;
  let thumbIndex = 0;
  let processingActive = true;

  log.step('visual-detect', `Starting streaming detection (interval: ${intervalSec}s, OCR: ${ocrEnabled})`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `fps=1/${intervalSec},scale=64:64`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ], {
      // stdout is piped, stderr is ignored to prevent buffer overflow
      stdio: ['ignore', 'pipe', 'ignore'] 
    });

    let streamBuffer = Buffer.alloc(0);
    let streamEnded = false;
    let isProcessingFrame = false;

    // Helper to process the stream data chunk by chunk
    const processStream = async () => {
      if (isProcessingFrame) return; // Wait for current frame to finish processing
      if (events.length >= maxEvents) {
        if (processingActive) {
          log.info('visual-detect', `Reached max vision call cap (${maxEvents}). Stopping.`);
          processingActive = false;
          ffmpeg.kill();
          resolve(events);
        }
        return;
      }

      const startIdx = streamBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
      const endIdx = streamBuffer.indexOf(Buffer.from([0xFF, 0xD9]));

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // We have a full JPEG buffer
        isProcessingFrame = true;
        ffmpeg.stdout.pause(); // Backpressure: tell ffmpeg to wait

        const jpegBuffer = streamBuffer.subarray(startIdx, endIdx + 2);
        streamBuffer = streamBuffer.subarray(endIdx + 2);
        thumbIndex++;
        const currentTs = (thumbIndex - 1) * intervalSec;

        try {
          await processThumbnail(jpegBuffer, currentTs);
        } catch (err) {
          log.warn('visual-detect', `Error processing frame at ${formatTs(currentTs)}: ${err}`);
        }

        isProcessingFrame = false;
        if (processingActive && !streamEnded) {
          ffmpeg.stdout.resume();
          processStream(); // Check if another frame is already in buffer
        } else if (streamEnded && streamBuffer.length > 0) {
           processStream(); // Flush remainder
        } else if (streamEnded) {
           resolve(events);
        }
      } else if (streamEnded && streamBuffer.length === 0) {
        resolve(events);
      }
    };

    ffmpeg.stdout.on('data', (chunk) => {
      streamBuffer = Buffer.concat([streamBuffer, chunk]);
      processStream();
    });

    ffmpeg.stdout.on('end', () => {
      streamEnded = true;
      processStream(); // Flush
    });

    ffmpeg.on('error', (err) => {
      if (processingActive) reject(err);
    });

    // ─── Thumbnail processing logic ───
    const processThumbnail = async (currentBuffer: Buffer, timestampSec: number) => {
      // 1. Initial Frame
      if (!prevBuffer || !prevKeptFullPath) {
        const fullPath = path.join(fullDir, 'frame_0001.jpg');
        await extractSingleFrame(videoPath, 0, fullPath);
        
        // Initial classification
        const classification = await classifyVisualEvent(fullPath, config.ollamaVisionModel);
        
        events.push({
          timestampSeconds: 0,
          eventType: classification.eventType,
          description: classification.description,
          changeScore: 100,
          visibleContent: classification.visibleContent || undefined,
          framePath: fullPath
        });

        prevBuffer = currentBuffer;
        prevKeptFullPath = fullPath;
        return;
      }

      // Check if we should skip this frame based on state machine
      if (state === 'SCANNING' && (thumbIndex % scanStep !== 0)) {
        return; // Skip intermediate frames while scanning
      }

      const diff = computeMAD(prevBuffer, currentBuffer);
      let isCandidate = false;
      let textChanged = false;
      let fullPath = path.join(fullDir, `frame_${String(thumbIndex).padStart(4, '0')}.jpg`);

      if (diff >= threshold) {
        isCandidate = true;
        await extractSingleFrame(videoPath, timestampSec, fullPath);
      } else if (diff >= borderlineLow && diff < threshold && ocrEnabled) {
        await extractSingleFrame(videoPath, timestampSec, fullPath);
        textChanged = await hasTextChanged(prevKeptFullPath, fullPath);
        if (textChanged) {
          isCandidate = true;
          log.info('visual-detect', `OCR caught text change at ${formatTs(timestampSec)} (pixel diff: ${diff.toFixed(1)}%)`);
        } else {
          try { await fs.unlink(fullPath); } catch {}
          stableCount++;
        }
      } else {
        stableCount++;
      }

      // Transition state if stable
      if (state === 'TRACKING' && stableCount >= trackStability) {
        state = 'SCANNING';
        log.info('visual-detect', `→ SCANNING mode at ${formatTs(timestampSec)} (stable for ${stableCount * intervalSec}s)`);
        stableCount = 0;
      }

      if (isCandidate) {
        log.info('visual-detect', `Candidate at ${formatTs(timestampSec)} (diff: ${diff.toFixed(1)}%). Classifying...`);
        
        // Differential Vision Analysis
        const classification = await classifyVisualEvent(fullPath, config.ollamaVisionModel, prevKeptFullPath);
        
        const changeScore = Math.round(diff * 10) / 10;
        events.push({
          timestampSeconds: timestampSec,
          eventType: classification.eventType,
          description: classification.description,
          changeScore,
          visibleContent: classification.visibleContent || undefined,
          framePath: fullPath
        });

        prevBuffer = currentBuffer;
        prevKeptFullPath = fullPath;
        stableCount = 0;

        // Semantic TRACKING trigger
        if (state === 'SCANNING' && (EDUCATIONAL_EVENTS.has(classification.eventType) || textChanged)) {
          state = 'TRACKING';
          log.info('visual-detect', `→ TRACKING mode at ${formatTs(timestampSec)} (Trigger: ${classification.eventType})`);
        } else if (state === 'SCANNING') {
           log.info('visual-detect', `Event ${classification.eventType} not educational enough to track. Remaining in SCANNING.`);
        }
      }
    };
  });
}
