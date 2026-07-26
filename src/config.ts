/**
 * Config — loads .env and exports a typed config object.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function env(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  // Paths
  watchFolder: path.resolve(root, env('WATCH_FOLDER', './data/watch')),
  workingDir: path.resolve(root, env('WORKING_DIR', './data/working')),
  reportsDir: path.resolve(root, env('REPORTS_DIR', './data/reports')),
  transcriptsDir: path.resolve(root, env('TRANSCRIPTS_DIR', './data/transcripts')),
  processedPath: path.resolve(root, env('PROCESSED_PATH', './data/processed.json')),
  trackingCsvPath: path.resolve(root, env('TRACKING_CSV_PATH', './data/tracking.csv')),

  // Polling interval in ms (default 30 seconds for dev)
  pollIntervalMs: parseInt(env('POLL_INTERVAL_MS', '30000'), 10),

  // Transcription
  transcriptionProvider: env('TRANSCRIPTION_PROVIDER', 'mock') as 'local' | 'assemblyai' | 'mock',
  assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY || '',
  whisperModelSize: env('WHISPER_MODEL_SIZE', 'base'), // tiny, base, small

  // Evaluation
  evaluationProvider: env('EVALUATION_PROVIDER', 'mock') as 'local' | 'anthropic' | 'mock',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514'),

  // Ollama (Local LLM)
  ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
  ollamaModel: env('OLLAMA_MODEL', 'llama3.1'),
  ollamaVisionModel: env('OLLAMA_VISION_MODEL', 'llava'),

  // Google API Settings
  googleCredentialsPath: path.resolve(root, env('GOOGLE_APPLICATION_CREDENTIALS', './google-credentials.json')),
  googleDriveFolderUrl: env('GOOGLE_DRIVE_FOLDER_URL', ''),
  googleSheetUrl: env('GOOGLE_SHEET_URL', ''),

  // Visual Event Detection
  frameExtractIntervalSec: parseInt(env('FRAME_EXTRACT_INTERVAL_SEC', '60'), 10), // Legacy fallback
  visualThumbIntervalSec: parseInt(env('VISUAL_THUMB_INTERVAL_SEC', '3'), 10),
  visualChangeThreshold: parseInt(env('VISUAL_CHANGE_THRESHOLD', '5'), 10),
  visualMaxEvents: parseInt(env('VISUAL_MAX_EVENTS', '30'), 10),
  visualOcrEnabled: env('VISUAL_OCR_ENABLED', 'true') === 'true',
  visualScanStep: parseInt(env('VISUAL_SCAN_STEP', '5'), 10),
  visualTrackStability: parseInt(env('VISUAL_TRACK_STABILITY', '10'), 10),
} as const;

/** Extract Drive Folder ID from Drive folder URL */
export function getDriveFolderId(url: string): string | null {
  if (!url) return null;
  // Format 1: https://drive.google.com/drive/folders/ID
  // Format 2: https://drive.google.com/drive/u/0/folders/ID
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Extract Spreadsheet ID from Google Sheet URL */
export function getSpreadsheetId(url: string): string | null {
  if (!url) return null;
  // Format: https://docs.google.com/spreadsheets/d/ID/edit...
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

