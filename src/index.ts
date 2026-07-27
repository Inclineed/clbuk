/**
 * Entry point — starts the folder watcher and processes new videos.
 *
 * Modes:
 *   npm start        → watch mode (polls every N seconds)
 *   npm run process  → one-shot (process all new files and exit)
 */

import path from 'path';
import { config } from './config.js';
import { log } from './logger.js';
import { findNewVideos } from './watcher.js';
import { processVideo } from './pipeline.js';
import { findNewDriveTranscripts, downloadDriveTranscript, cleanupLocalVideo, hasGoogleCredentials } from './driveWatcher.js';

const ONE_SHOT = process.argv.includes('--once');

async function processAllNew(): Promise<number> {
  let processed = 0;

  // 1. Process local files if any
  const localVideos = await findNewVideos();
  for (const video of localVideos) {
    try {
      await processVideo(video);
      processed++;
    } catch (err) {
      log.error('main', `Failed to process local file ${video.fileName}, skipping.`);
      log.error('main', err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Process Google Drive files if configured
  if (config.googleDriveFolderUrl) {
    const driveTranscripts = await findNewDriveTranscripts();
    for (const driveTranscript of driveTranscripts) {
      let ext = path.extname(driveTranscript.fileName);
      if (driveTranscript.mimeType === 'application/vnd.google-apps.document') {
        ext = '.txt';
      }
      const tempLocalPath = path.join(config.watchFolder, `drive_${driveTranscript.fileId}${ext}`);
      
      try {
        await downloadDriveTranscript(driveTranscript.fileId, tempLocalPath, driveTranscript.mimeType);
        
        await processVideo({
          fileId: driveTranscript.fileId,
          fileName: driveTranscript.fileName,
          filePath: tempLocalPath,
        });
        
        processed++;
      } catch (err) {
        log.error('main', `Failed to process Drive file ${driveTranscript.fileName}, skipping.`);
        log.error('main', err instanceof Error ? err.message : String(err));
      } finally {
        await cleanupLocalVideo(tempLocalPath);
      }
    }
  }

  return processed;
}


async function main() {
  log.info('main', '╔══════════════════════════════════════════╗');
  log.info('main', '║   Classsbuk AI Class Recording Reviewer  ║');
  log.info('main', '╚══════════════════════════════════════════╝');
  log.info('main', `Watch folder:  ${config.watchFolder}`);
  log.info('main', `Transcription: ${config.transcriptionProvider}`);
  log.info('main', `Evaluation:    ${config.evaluationProvider}`);
  log.info('main', `Mode:          ${ONE_SHOT ? 'one-shot' : 'watch'}`);
  log.info('main', '');

  if (ONE_SHOT) {
    // Process everything currently in the folder and exit
    const count = await processAllNew();
    log.info('main', `Done. Processed ${count} video(s).`);
    process.exit(0);
  }

  // Watch mode — poll on an interval
  log.info('main', `Polling every ${config.pollIntervalMs / 1000}s. Drop videos into: ${config.watchFolder}`);
  log.info('main', 'Press Ctrl+C to stop.\n');

  let running = true;
  let timeoutId: NodeJS.Timeout | undefined;

  async function poll() {
    if (!running) return;
    try {
      await processAllNew();
    } catch (err) {
      log.error('main', 'Polling cycle error:', err);
    }
    if (running && !ONE_SHOT) {
      timeoutId = setTimeout(poll, config.pollIntervalMs);
    }
  }

  // Run immediately on start (which schedules subsequent runs)
  await poll();

  // Graceful shutdown
  process.on('SIGINT', () => {
    log.info('main', '\nShutting down...');
    running = false;
    if (timeoutId) clearTimeout(timeoutId);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    running = false;
    if (timeoutId) clearTimeout(timeoutId);
    process.exit(0);
  });
}

main().catch((err) => {
  log.error('main', 'Fatal error:', err);
  process.exit(1);
});
