import crypto from 'crypto';
import path from 'path';
import { log } from './logger.js';
import { config } from './config.js';
import { parseFileName } from './types.js';
import type { RecordingInfo, PipelineResult } from './types.js';
import { probeDuration, extractAudio } from './audioExtractor.js';
import { extractFrames } from './frameExtractor.js';
import { analyzeVideoVisuals } from './visionAnalyzer.js';
import { extractSmartFrames } from './smartFrameExtractor.js';
import { buildMultimodalTimeline, type AnalyzedFrame } from './timelineBuilder.js';
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
 *   4. Smart frame extraction + vision analysis (needs transcript for timeline)
 *   5. Evaluate with LLM (receives interleaved multimodal timeline)
 *   6. Generate report
 *   7. Update tracking sheet
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

    // ── Step 4/6: Smart visual analysis ──────────────────────
    // Now that we have the transcript, we can build a time-synchronized
    // multimodal timeline that interleaves visual events with speech.
    let multimodalTimeline: string | undefined;
    let visualTimeline: string | undefined; // Legacy fallback for report

    if (config.evaluationProvider !== 'mock') {
      log.step('pipeline', 'Step 4/6 — Smart frame analysis...');
      const framesDir = path.join(config.workingDir, recordingId, 'frames');

      try {
        // Phase 1: Extract and filter distinct frames
        const smartFrames = await extractSmartFrames(file.filePath, framesDir);

        if (smartFrames.length > 0) {
          // Phase 2: Describe each distinct frame with vision LLM
          log.step('pipeline', `Analyzing ${smartFrames.length} distinct frames with vision LLM...`);
          const analyzedFrames: AnalyzedFrame[] = [];

          // Map SmartFrame[] to SampledFrame[] for the existing analyzeVideoVisuals
          const sampledFrames = smartFrames.map(sf => ({
            framePath: sf.framePath,
            timestampSeconds: sf.timestampSeconds,
          }));
          const rawTimeline = await analyzeVideoVisuals(sampledFrames);

          // Parse the raw timeline back into AnalyzedFrame objects
          const timelineLines = rawTimeline.split('\n');
          for (let i = 0; i < smartFrames.length && i < timelineLines.length; i++) {
            const line = timelineLines[i];
            // Extract the description after the timestamp prefix "[MM:SS] "
            const descMatch = line.match(/^\[\d{2}:\d{2}\]\s*(.+)$/);
            const description = descMatch ? descMatch[1] : line;

            analyzedFrames.push({
              timestampSeconds: smartFrames[i].timestampSeconds,
              description,
              changeScore: smartFrames[i].changeScore,
            });
          }

          // Build time-synchronized multimodal timeline
          multimodalTimeline = buildMultimodalTimeline(analyzedFrames, transcript);
          visualTimeline = rawTimeline; // Keep for backward compat in report/eval

          log.success('pipeline', `Built multimodal timeline with ${analyzedFrames.length} visual events.`);
        } else {
          log.warn('pipeline', 'Smart extraction produced 0 frames. Falling back to fixed-interval...');
          throw new Error('No distinct frames found');
        }
      } catch (err: any) {
        // Fallback to legacy fixed-interval extraction
        log.warn('pipeline', `Smart analysis failed (${err.message}), falling back to fixed-interval...`);
        try {
          const fallbackFramesDir = path.join(config.workingDir, recordingId, 'frames_fallback');
          const frames = await extractFrames(file.filePath, fallbackFramesDir, config.frameExtractIntervalSec);
          visualTimeline = await analyzeVideoVisuals(frames);
        } catch (fallbackErr: any) {
          log.warn('pipeline', `Fallback visual analysis also failed: ${fallbackErr.message}`);
        }
      }
    } else {
      log.info('pipeline', 'Mock mode active: skipping frame extraction.');
      multimodalTimeline = `═══ 00:00 ═══
[VISUAL] Screen share active: teacher presenting linear algebra slides. Teacher is visible in the corner webcam.
[SPEECH 00:00-01:00] Teacher: "Good morning class, today we are covering linear algebra."

═══ 01:00 ═══
[VISUAL CHANGE] Screen share active: teacher writing on virtual whiteboard.
[SPEECH 01:00-03:00] Teacher: "Let me show you how matrix multiplication works."

═══ 03:00 ═══
[VISUAL CHANGE] Teacher speaking directly to camera, no screen share.
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
