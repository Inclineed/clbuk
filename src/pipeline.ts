import crypto from 'crypto';
import path from 'path';
import { log } from './logger.js';
import { config } from './config.js';
import { parseFileName } from './types.js';
import type { RecordingInfo, PipelineResult } from './types.js';
import { probeDuration, extractAudio } from './audioExtractor.js';
import { extractFrames } from './frameExtractor.js';
import { analyzeVideoVisuals, classifyVisualEvent } from './visionAnalyzer.js';
import { detectVisualChanges, type VisualEvent } from './visualEventDetector.js';
import { buildMultimodalTimeline } from './timelineBuilder.js';
import { transcribe } from './transcriber.js';
import { evaluate } from './evaluator.js';
import { generateReport } from './reportGenerator.js';
import { updateSheet } from './sheetUpdater.js';
import { markProcessed } from './watcher.js';

/**
 * Process a single video file through the entire pipeline.
 *
 * Step order (reordered to enable time-synchronized analysis):
 *   1. Probe duration
 *   2. Extract audio
 *   3. Transcribe audio
 *   4. Visual event detection (adaptive) + vision LLM classification
 *   5. Evaluate with LLM (receives interleaved multimodal timeline)
 *   6. Generate report & update tracking sheet
 */
export async function processVideo(file: {
  fileId: string;
  fileName: string;
  filePath: string;
}): Promise<PipelineResult> {
  const recordingId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  log.info('pipeline', `════════════════════════════════════════`);
  log.info('pipeline', `Processing: ${file.fileName} (id: ${recordingId})`);
  log.info('pipeline', `════════════════════════════════════════`);

  try {
    // 1. Parse filename for metadata
    const parsed = parseFileName(file.fileName);
    const recording: RecordingInfo = {
      fileId: file.fileId,
      fileName: file.fileName,
      filePath: file.filePath,
      ...parsed,
    };

    // ── Step 1/6: Probe duration ─────────────────────────────
    log.step('pipeline', 'Step 1/6 — Probing video duration...');
    const durationSeconds = await probeDuration(file.filePath);
    recording.durationSeconds = durationSeconds;
    log.success('pipeline', `Duration: ${Math.round(durationSeconds / 60)} minutes`);

    // ── Step 2/6: Extract audio ──────────────────────────────
    log.step('pipeline', 'Step 2/6 — Extracting audio...');
    const audioPath = await extractAudio(recordingId, file.filePath);

    // ── Step 3/6: Transcribe ─────────────────────────────────
    log.step('pipeline', 'Step 3/6 — Transcribing...');
    const { transcript, transcriptPath } = await transcribe(recordingId, audioPath, durationSeconds);

    // ── Step 4/6: Visual event detection ─────────────────────
    let multimodalTimeline: string | undefined;
    let visualTimeline: string | undefined;

    if (config.evaluationProvider !== 'mock') {
      log.step('pipeline', 'Step 4/6 — Visual event detection...');
      const framesDir = path.join(config.workingDir, recordingId, 'frames');

      try {
        // Streaming adaptive scan with interleaved LLM classification
        const visualEvents = await detectVisualChanges(file.filePath, framesDir);

        if (visualEvents.length > 0) {
          // Build time-synchronized multimodal timeline
          multimodalTimeline = buildMultimodalTimeline(visualEvents, transcript);
          log.success('pipeline', `Built multimodal timeline with ${visualEvents.length} visual events.`);
        } else {
          log.warn('pipeline', 'Visual detection produced 0 events. Falling back to fixed-interval...');
          throw new Error('No visual events detected');
        }
      } catch (err: any) {
        // Fallback to legacy fixed-interval extraction
        log.warn('pipeline', `Visual detection failed (${err.message}), falling back to fixed-interval...`);
        try {
          const fallbackDir = path.join(config.workingDir, recordingId, 'frames_fallback');
          const frames = await extractFrames(file.filePath, fallbackDir, config.frameExtractIntervalSec);
          visualTimeline = await analyzeVideoVisuals(frames);
        } catch (fallbackErr: any) {
          log.warn('pipeline', `Fallback visual analysis also failed: ${fallbackErr.message}`);
        }
      }
    } else {
      log.info('pipeline', 'Mock mode active: skipping visual detection.');
      multimodalTimeline = `═══ 00:00 ═══
[SLIDE_CHANGED] Title slide "Introduction to Linear Algebra" displayed
  Content: "Introduction to Linear Algebra — Chapter 1"
[SPEECH 00:00-01:00] Teacher: "Good morning class, today we are covering linear algebra."

═══ 01:00 ═══
[WHITEBOARD_UPDATED] Teacher writing matrix multiplication example on virtual whiteboard
[SPEECH 01:00-03:00] Teacher: "Let me show you how matrix multiplication works."

═══ 03:00 ═══
[IDLE_VISUAL] Teacher speaking directly to camera, no screen share active
[SPEECH 03:00-05:00] Teacher: "Now let's practice with an exercise."`;
    }

    // ── Step 5/6: Evaluate with LLM ─────────────────────────
    log.step('pipeline', 'Step 5/6 — Evaluating with LLM...');
    const { evaluation } = await evaluate(recordingId, transcript, multimodalTimeline || visualTimeline);

    // ── Step 6/6: Generate report & update sheet ─────────────
    log.step('pipeline', 'Step 6/6 — Generating report & updating sheet...');
    const reportPath = await generateReport(recording, evaluation, transcript, transcriptPath);
    await updateSheet(recording, evaluation, reportPath, transcriptPath);

    // Mark as processed
    await markProcessed(file.fileId);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.success('pipeline', `✅ Completed in ${elapsed}s — ${file.fileName}`);
    log.info('pipeline', `Report: ${reportPath}`);
    log.info('pipeline', `════════════════════════════════════════\n`);

    return { recording, transcript, evaluation, reportPath };

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.error('pipeline', `❌ Failed after ${elapsed}s — ${file.fileName}`);
    log.error('pipeline', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
