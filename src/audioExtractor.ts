/**
 * Audio Extractor — uses ffmpeg to pull mono 16kHz WAV from video.
 * Also probes for duration via ffprobe.
 */

import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { log } from './logger.js';

// Point fluent-ffmpeg at the bundled ffprobe binary
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/** Get video duration in seconds using ffprobe. */
export function probeDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Extract audio from a video file.
 * Returns the path to the generated WAV file.
 */
export async function extractAudio(recordingId: string, videoPath: string): Promise<string> {
  const workDir = path.join(config.workingDir, recordingId);
  await fs.mkdir(workDir, { recursive: true });

  const outputPath = path.join(workDir, 'audio.wav');

  log.step('audio', `Extracting audio from ${path.basename(videoPath)}`);

  return new Promise<string>((resolve, reject) => {
    ffmpeg(videoPath)
      .audioChannels(1)        // mono
      .audioFrequency(16000)   // 16kHz — optimal for speech-to-text
      .audioCodec('pcm_s16le') // uncompressed PCM
      .format('wav')
      .on('start', (cmd) => {
        log.info('audio', `ffmpeg started: ${cmd.slice(0, 100)}...`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          log.info('audio', `Progress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        log.success('audio', `Audio extracted → ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        log.error('audio', `ffmpeg error: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}
