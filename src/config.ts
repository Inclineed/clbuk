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

// Detect if API keys are provided to override local/default configurations
const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
const hasOpenAIKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
const hasGeminiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());

const rawEvaluationProvider = process.env.EVALUATION_PROVIDER || '';

let evaluationProvider: 'local' | 'anthropic' | 'openai' | 'gemini' | 'mock' = 'local';
if (rawEvaluationProvider === 'mock') {
  evaluationProvider = 'mock';
} else if (rawEvaluationProvider === 'anthropic' || rawEvaluationProvider === 'openai' || rawEvaluationProvider === 'gemini') {
  evaluationProvider = rawEvaluationProvider;
} else if (hasAnthropicKey) {
  evaluationProvider = 'anthropic';
} else if (hasOpenAIKey) {
  evaluationProvider = 'openai';
} else if (hasGeminiKey) {
  evaluationProvider = 'gemini';
} else {
  evaluationProvider = 'local';
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

  // Evaluation
  evaluationProvider,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514'),
  
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: env('OPENAI_MODEL', 'gpt-4o'),

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: env('GEMINI_MODEL', 'gemini-1.5-flash'),

  // Ollama (Local LLM)
  ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
  ollamaModel: env('OLLAMA_MODEL', 'llama3.1'),

  // Google API Settings
  googleCredentialsPath: path.resolve(root, env('GOOGLE_APPLICATION_CREDENTIALS', './google-credentials.json')),
  googleDriveFolderUrl: env('GOOGLE_DRIVE_FOLDER_URL', ''),
  googleSheetUrl: env('GOOGLE_SHEET_URL', ''),
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

