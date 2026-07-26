import crypto from 'crypto';
import path from 'path';
import { log } from './logger.js';
import { config } from './config.js';
import { parseFileName } from './types.js';
import type { RecordingInfo, PipelineResult } from './types.js';
import { probeDuration, extractAudio } from './audioExtractor.js';
import { extractFrames } from './frameExtractor.js';
import { analyzeVideoVisuals } from './visionAnalyzer.js';
import { transcribe } from './transcriber.js';
import { evaluate } from './evaluator.js';
import { generateReport } from './reportGenerator.js';
import { updateSheet } from './sheetUpdater.js';
import { markProcessed } from './watcher.js';

/**
 * Process a single video file through the entire pipeline.
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

    // 2. Probe duration
    log.step('pipeline', 'Step 1/6 — Probing video duration...');
    const durationSeconds = await probeDuration(file.filePath);
    recording.durationSeconds = durationSeconds;
    log.success('pipeline', `Duration: ${Math.round(durationSeconds / 60)} minutes`);

    // 3. Extract and analyze visual frames (multimodal vision step)
    let visualTimeline: string | undefined;
    if (config.evaluationProvider !== 'mock') {
      log.step('pipeline', 'Step 1.5/6 — Extracting and analyzing video frames...');
      const framesDir = path.join(config.workingDir, recordingId, 'frames');
      try {
        const frames = await extractFrames(file.filePath, framesDir, config.frameExtractIntervalSec);
        visualTimeline = await analyzeVideoVisuals(frames);
      } catch (err: any) {
        log.warn('pipeline', `Visual analysis failed, proceeding with audio only: ${err.message}`);
      }
    } else {
      log.info('pipeline', 'Mock mode active: skipping frame extraction.');
      visualTimeline = `[00:00] Screen share active: teacher presenting linear algebra slides. Teacher is visible in the corner webcam.
[01:00] Screen share active: teacher writing on virtual whiteboard.
[03:00] Teacher speaking directly to camera, screen share stopped.
[05:00] Screen share active: teacher presenting algebraic practice problem.`;
    }

    // 4. Extract audio
    log.step('pipeline', 'Step 2/6 — Extracting audio...');
    const audioPath = await extractAudio(recordingId, file.filePath);

    // 5. Transcribe
    log.step('pipeline', 'Step 3/6 — Transcribing...');
    const { transcript, transcriptPath } = await transcribe(recordingId, audioPath, durationSeconds);

    // 6. Evaluate (both transcript and visual timeline are analyzed together)
    log.step('pipeline', 'Step 4/6 — Evaluating with LLM...');
    const { evaluation } = await evaluate(recordingId, transcript, visualTimeline);

    // 7. Generate report
    log.step('pipeline', 'Step 5/6 — Generating report...');
    const reportPath = await generateReport(recording, evaluation, transcript, transcriptPath);

    // 8. Update tracking sheet
    log.step('pipeline', 'Step 6/6 — Updating tracking sheet...');
    await updateSheet(recording, evaluation, reportPath, transcriptPath);

    // 9. Mark as processed
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
