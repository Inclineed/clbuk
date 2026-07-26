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

// ─── Structured Visual Event Classification ──────────────────

import type { VisualEventType } from './visualEventDetector.js';

export type VisualContentType = 'WHITEBOARD' | 'SLIDES' | 'CODE_EDITOR' | 'DOCUMENT' | 'BROWSER' | 'VIDEO_DEMO' | 'TALKING_HEAD' | 'MIXED' | 'OTHER';

export interface VisualEventClassification {
  contentType: VisualContentType;
  eventType: VisualEventType;
  description: string;
  visibleContent: string;
}

const VALID_EVENT_TYPES: Set<string> = new Set([
  'SLIDE_CHANGED', 'WHITEBOARD_UPDATED', 'DIAGRAM_EXTENDED', 'CODE_MODIFIED',
  'TEACHER_WRITING', 'TEACHER_STOPPED_WRITING', 'SCREEN_SHARE_STARTED',
  'SCREEN_SHARE_ENDED', 'IDLE_VISUAL', 'OTHER',
]);

const VALID_CONTENT_TYPES: Set<string> = new Set([
  'WHITEBOARD', 'SLIDES', 'CODE_EDITOR', 'DOCUMENT', 'BROWSER', 
  'VIDEO_DEMO', 'TALKING_HEAD', 'MIXED', 'OTHER'
]);

/**
 * Classify a single frame into a structured visual event using the vision LLM.
 * Returns a typed event object with contentType, eventType, description, and visibleContent.
 *
 * Falls back to raw text description if JSON parsing fails.
 */
export async function classifyVisualEvent(
  framePath: string,
  model: string,
  previousFramePath?: string
): Promise<VisualEventClassification> {
  const endpoint = `${config.ollamaUrl}/api/chat`;

  const imageBuffer = await fs.readFile(framePath);
  const imageBase64 = imageBuffer.toString('base64');
  
  const images = [imageBase64];
  if (previousFramePath) {
    try {
      const prevBuffer = await fs.readFile(previousFramePath);
      // Insert previous frame FIRST so model sees it as image 1 (before) and current as image 2 (after)
      images.unshift(prevBuffer.toString('base64'));
    } catch {
      log.warn('report', `Could not read previous frame for differential analysis: ${previousFramePath}`);
    }
  }

  // Load the structured event prompt from file
  let prompt = `Analyze this video frame from an online class recording and classify the visual event.`;

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
        images,
      }
    ],
    format: 'json',
    stream: false,
    options: {
      temperature: 0.1,
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
  const rawContent = (data.message?.content || '').trim();

  // Try to parse structured JSON
  try {
    const parsed = JSON.parse(rawContent);
    const eventType = VALID_EVENT_TYPES.has(parsed.eventType) ? parsed.eventType : 'OTHER';
    const contentType = VALID_CONTENT_TYPES.has(parsed.contentType) ? parsed.contentType : 'OTHER';
    return {
      contentType: contentType as VisualContentType,
      eventType: eventType as VisualEventType,
      description: parsed.description || rawContent,
      visibleContent: parsed.visibleContent || '',
    };
  } catch {
    // JSON parsing failed — extract what we can from raw text
    let detectedType: VisualEventType = 'OTHER';
    const upper = rawContent.toUpperCase();
    if (upper.includes('SLIDE')) detectedType = 'SLIDE_CHANGED';
    else if (upper.includes('WHITEBOARD') || upper.includes('WRITING')) detectedType = 'WHITEBOARD_UPDATED';
    else if (upper.includes('CODE')) detectedType = 'CODE_MODIFIED';
    else if (upper.includes('DIAGRAM')) detectedType = 'DIAGRAM_EXTENDED';
    else if (upper.includes('SCREEN SHARE') || upper.includes('SCREENSHARE')) detectedType = 'SCREEN_SHARE_STARTED';

    let detectedContentType: VisualContentType = 'OTHER';
    if (upper.includes('SLIDE')) detectedContentType = 'SLIDES';
    else if (upper.includes('WHITEBOARD')) detectedContentType = 'WHITEBOARD';
    else if (upper.includes('CODE')) detectedContentType = 'CODE_EDITOR';

    return {
      contentType: detectedContentType,
      eventType: detectedType,
      description: rawContent || 'No visual data obtained.',
      visibleContent: '',
    };
  }
}
