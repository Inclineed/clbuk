import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { log } from './logger.js';
import { config } from './config.js';
import { parseFileName } from './types.js';
import type { RecordingInfo, PipelineResult, Transcript, TranscriptSegment } from './types.js';
import { evaluate } from './evaluator.js';
import { generateReport } from './reportGenerator.js';
import { updateSheet } from './sheetUpdater.js';
import { markProcessed } from './watcher.js';

/**
 * Load and parse a transcript file from disk.
 * Supports:
 *   - .json: parses structured Transcript JSON.
 *   - .txt: parses timestamped lines (e.g. "[MM:SS] Speaker: text" or "Speaker: text") and falls back to simple text.
 */
async function loadTranscriptFromFile(filePath: string, recordingId: string): Promise<Transcript> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.segments)) {
        return {
          recordingId: parsed.recordingId || recordingId,
          segments: parsed.segments,
          durationSeconds: typeof parsed.durationSeconds === 'number' ? parsed.durationSeconds : 0,
          speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [...new Set(parsed.segments.map((s: any) => s.speaker || 'Speaker'))] as string[],
          provider: parsed.provider || 'drive-json',
          createdAt: parsed.createdAt || new Date().toISOString(),
        };
      } else {
        throw new Error('JSON format does not contain a segments array');
      }
    } catch (err: any) {
      log.warn('pipeline', `Failed to parse JSON transcript as structured Transcript: ${err.message}. Treating as plain text.`);
    }
  }

  // Parse plain text transcripts
  const lines = raw.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let currentTime = 0;

  // Regex to match:
  // 1. [MM:SS] Speaker Name: Text
  // 2. [HH:MM:SS] Speaker Name: Text
  // 3. Speaker Name: Text (without timestamp)
  const timestampSpeakerRegex = /^\[?(\d{1,2})?:?(\d{1,2}):(\d{2})\]?\s*([^:\n]+):\s*(.*)$/;
  const speakerTextRegex = /^([^:\n]+):\s*(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const tsMatch = trimmed.match(timestampSpeakerRegex);
    if (tsMatch) {
      const hrsStr = tsMatch[1];
      const minsStr = tsMatch[2];
      const secsStr = tsMatch[3];
      const speaker = tsMatch[4].trim();
      const text = tsMatch[5].trim();

      let seconds = 0;
      if (secsStr !== undefined) {
        // HH:MM:SS or H:MM:SS
        const h = parseInt(hrsStr || '0', 10);
        const m = parseInt(minsStr, 10);
        const s = parseInt(secsStr, 10);
        seconds = h * 3600 + m * 60 + s;
      } else {
        // MM:SS
        const m = parseInt(minsStr, 10);
        const s = parseInt(secsStr, 10);
        seconds = m * 60 + s;
      }

      segments.push({
        speaker,
        startTime: seconds,
        endTime: seconds + 10, // estimate 10s default
        text,
      });
      currentTime = seconds + 10;
    } else {
      const spkMatch = trimmed.match(speakerTextRegex);
      if (spkMatch) {
        const speaker = spkMatch[1].trim();
        const text = spkMatch[2].trim();
        segments.push({
          speaker,
          startTime: currentTime,
          endTime: currentTime + 10,
          text,
        });
        currentTime += 10;
      } else {
        segments.push({
          speaker: 'Speaker 1',
          startTime: currentTime,
          endTime: currentTime + 10,
          text: trimmed,
        });
        currentTime += 10;
      }
    }
  }

  // Adjust endTimes to startTimes of subsequent segments
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].endTime = segments[i + 1].startTime;
  }

  const durationSeconds = segments.length > 0 ? segments[segments.length - 1].endTime : 0;
  const speakers = [...new Set(segments.map(s => s.speaker))];

  return {
    recordingId,
    segments,
    durationSeconds,
    speakers,
    provider: 'drive-text',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Process a single transcript file through the simplified pipeline.
 */
export async function processVideo(file: {
  fileId: string;
  fileName: string;
  filePath: string;
}): Promise<PipelineResult> {
  const recordingId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  log.info('pipeline', `════════════════════════════════════════`);
  log.info('pipeline', `Processing Transcript: ${file.fileName} (id: ${recordingId})`);
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

    // ── Step 1/3: Load and Parse Transcript ──────────────────
    log.step('pipeline', 'Step 1/3 — Loading and parsing transcript file...');
    const transcript = await loadTranscriptFromFile(file.filePath, recordingId);
    recording.durationSeconds = transcript.durationSeconds;

    // Save parsed transcript to transcripts folder
    await fs.mkdir(config.transcriptsDir, { recursive: true });
    const transcriptPath = path.join(config.transcriptsDir, `${recordingId}.json`);
    await fs.writeFile(transcriptPath, JSON.stringify(transcript, null, 2), 'utf-8');
    log.success('pipeline', `Transcript processed, saved as → ${path.basename(transcriptPath)}`);

    // ── Step 2/3: Evaluate with LLM (Transcript Only) ───────
    log.step('pipeline', 'Step 2/3 — Evaluating transcript with LLM...');
    const { evaluation } = await evaluate(recordingId, transcript);

    // ── Step 3/3: Generate report & update sheet ─────────────
    log.step('pipeline', 'Step 3/3 — Generating report & updating sheet...');
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
