/**
 * Watcher — polls a local folder for new video files.
 * Tracks what's been processed in a simple JSON file.
 */

import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { log } from './logger.js';

const TRANSCRIPT_EXTENSIONS = new Set(['.json', '.txt']);

/** Load the set of already-processed file IDs. */
async function loadProcessed(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(config.processedPath, 'utf-8');
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Mark a file ID as processed. */
export async function markProcessed(fileId: string): Promise<void> {
  const processed = await loadProcessed();
  processed.add(fileId);
  await fs.mkdir(path.dirname(config.processedPath), { recursive: true });
  await fs.writeFile(config.processedPath, JSON.stringify([...processed], null, 2));
}

/** Check if a file has already been processed. */
export async function isProcessed(fileId: string): Promise<boolean> {
  const processed = await loadProcessed();
  return processed.has(fileId);
}

/**
 * Scan the watch folder and return any new (unprocessed) transcript files.
 * Each file's name is used as its unique ID.
 */
export async function findNewVideos(): Promise<{ fileId: string; fileName: string; filePath: string }[]> {
  // Ensure the watch folder exists
  await fs.mkdir(config.watchFolder, { recursive: true });

  const entries = await fs.readdir(config.watchFolder, { withFileTypes: true });
  const processed = await loadProcessed();
  const newFiles: { fileId: string; fileName: string; filePath: string }[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TRANSCRIPT_EXTENSIONS.has(ext)) continue;
    if (processed.has(entry.name)) continue;

    newFiles.push({
      fileId: entry.name,
      fileName: entry.name,
      filePath: path.join(config.watchFolder, entry.name),
    });
  }

  if (newFiles.length > 0) {
    log.info('watcher', `Found ${newFiles.length} new transcript(s)`);
  }

  return newFiles;
}
