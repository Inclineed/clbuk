/**
 * Frame Extractor — uses ffmpeg to sample video frames at a regular interval.
 * Discards video visual streams except for static JPEGs.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { log } from './logger.js';

/**
 * Extract one frame every N seconds from a video file and save to target directory.
 * Returns the list of extracted frame filenames with their absolute paths.
 */
export function extractFrames(
  videoPath: string,
  outputDir: string,
  intervalSeconds: number = 60
): Promise<{ framePath: string; timestampSeconds: number }[]> {
  return new Promise((resolve, reject) => {
    log.step('audio', `Extracting visual frames from video (1 frame every ${intervalSeconds}s)...`);

    // Ensure output directory exists
    fs.mkdir(outputDir, { recursive: true })
      .then(() => {
        // Output template like frame_001.jpg, frame_002.jpg
        const outputPattern = path.join(outputDir, 'frame_%03d.jpg');

        // Command: ffmpeg -y -i <videoPath> -vf fps=1/<interval> -q:v 4 <outputPattern>
        // -q:v 4 sets a reasonable JPEG quality (1-31 scale, lower is better)
        const args = [
          '-y',
          '-i', videoPath,
          '-vf', `fps=1/${intervalSeconds}`,
          '-q:v', '5',
          outputPattern
        ];

        execFile('ffmpeg', args, (error, stdout, stderr) => {
          if (error) {
            log.error('audio', `Frame extraction failed: ${stderr || error.message}`);
            return reject(error);
          }

          // Scan output directory to compile list of files
          fs.readdir(outputDir)
            .then((files) => {
              const JpegPattern = /^frame_\d{3}\.jpg$/;
              const extracted = files
                .filter(f => JpegPattern.test(f))
                .map(file => {
                  // Extract frame index: e.g. "frame_001.jpg" -> 1
                  const idxStr = file.match(/frame_(\d{3})\.jpg/)?.[1] || '1';
                  const index = parseInt(idxStr, 10);
                  // frame_001.jpg is at 0s, frame_002.jpg at N seconds, etc.
                  const timestampSeconds = (index - 1) * intervalSeconds;
                  
                  return {
                    framePath: path.join(outputDir, file),
                    timestampSeconds
                  };
                })
                .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

              log.success('audio', `Extracted ${extracted.length} frames.`);
              resolve(extracted);
            })
            .catch(reject);
        });
      })
      .catch(reject);
  });
}
