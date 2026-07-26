/**
 * Vision Analyzer — uses local Ollama Vision LLM (like llava)
 * to describe sampled video frames and compile a visual timeline.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

interface SampledFrame {
  framePath: string;
  timestampSeconds: number;
}

/**
 * Analyze a single frame image using local Ollama Vision LLM.
 */
async function analyzeFrame(framePath: string, model: string): Promise<string> {
  const endpoint = `${config.ollamaUrl}/api/chat`;

  // Read frame image and encode as base64
  const imageBuffer = await fs.readFile(framePath);
  const imageBase64 = imageBuffer.toString('base64');

  // Load custom prompt from file if exists
  let prompt = `Analyze this video frame from an online class. Describe what you see in one short, objective sentence (e.g. "Screen sharing slides on math, teacher is visible in the corner" or "Teacher speaking directly to camera, no screen share" or "Black screen").`;
  try {
    const customPromptPath = path.join(root, 'prompts', 'frame_analysis.txt');
    const content = await fs.readFile(customPromptPath, 'utf-8');
    if (content.trim()) {
      prompt = content.trim();
    }
  } catch {
    // Fallback to default
  }

  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: prompt,
        images: [imageBase64],
      }
    ],
    stream: false,
    options: {
      temperature: 0.1, // Keep description factual
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama Vision error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  const description = data.message?.content;

  if (!description) {
    return 'No visual data obtained.';
  }

  return description.trim();
}

/**
 * Run visual frame analysis on all sampled frames.
 * Compiles a formatted text-based visual timeline.
 */
export async function analyzeVideoVisuals(
  frames: SampledFrame[]
): Promise<string> {
  if (frames.length === 0) {
    return 'No video frames extracted.';
  }

  log.step('report', `Starting visual analysis of ${frames.length} frames using local Ollama Vision (${config.ollamaVisionModel})...`);

  const timelineLines: string[] = [];

  // Process frames sequentially
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const minutes = Math.floor(frame.timestampSeconds / 60);
    const seconds = Math.floor(frame.timestampSeconds % 60);
    const ts = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    try {
      log.info('report', `Analyzing frame ${i + 1}/${frames.length} (Timestamp: ${ts})...`);
      const description = await analyzeFrame(frame.framePath, config.ollamaVisionModel);
      timelineLines.push(`[${ts}] ${description}`);
    } catch (err: any) {
      log.warn('report', `Failed to analyze frame at ${ts}: ${err.message}`);
      timelineLines.push(`[${ts}] Visual analysis failed for this frame.`);
    }
  }

  const visualTimeline = timelineLines.join('\n');
  log.success('report', 'Visual timeline generated.');
  return visualTimeline;
}
