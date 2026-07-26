import { google } from 'googleapis';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { config, getDriveFolderId } from './config.js';
import { log } from './logger.js';
import { isProcessed } from './watcher.js';

// Supported video mime types
const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/avi',
  'video/quicktime',
]);

/** Verify Google credentials file exists */
export async function hasGoogleCredentials(): Promise<boolean> {
  try {
    await fsPromises.access(config.googleCredentialsPath);
    return true;
  } catch {
    return false;
  }
}

/** Get authenticated Google client */
function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    keyFile: config.googleCredentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

export interface DriveVideoFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

/**
 * Scan the Google Drive folder for unprocessed videos.
 */
export async function findNewDriveVideos(): Promise<DriveVideoFile[]> {
  if (!(await hasGoogleCredentials())) {
    log.warn('watcher', `Google Service Account credentials file not found at: ${config.googleCredentialsPath}`);
    log.warn('watcher', 'Please place google-credentials.json in your project root or configure GOOGLE_APPLICATION_CREDENTIALS in .env.');
    return [];
  }

  const folderId = getDriveFolderId(config.googleDriveFolderUrl);
  if (!folderId) {
    log.warn('watcher', `Invalid or missing GOOGLE_DRIVE_FOLDER_URL: "${config.googleDriveFolderUrl}"`);
    return [];
  }

  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  try {
    log.step('watcher', `Scanning Google Drive folder: ${folderId} ...`);
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 100,
    });

    const files = response.data.files || [];
    const newVideos: DriveVideoFile[] = [];

    for (const file of files) {
      if (!file.id || !file.name) continue;

      // Filter by mimeType or extension
      const isVideoMime = file.mimeType ? VIDEO_MIME_TYPES.has(file.mimeType) : false;
      const ext = path.extname(file.name).toLowerCase();
      const isVideoExt = ['.mp4', '.webm', '.mkv', '.avi', '.mov'].includes(ext);

      if (!isVideoMime && !isVideoExt) continue;

      // Use file.id for unique state tracking rather than name
      const alreadyProcessed = await isProcessed(file.id);
      if (alreadyProcessed) continue;

      newVideos.push({
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType || 'video/mp4',
        sizeBytes: file.size ? parseInt(file.size, 10) : undefined,
      });
    }

    if (newVideos.length > 0) {
      log.success('watcher', `Found ${newVideos.length} new video(s) in Google Drive folder.`);
    }

    return newVideos;
  } catch (err: any) {
    log.error('watcher', `Google Drive folder scan failed: ${err.message}`);
    return [];
  }
}

/**
 * Download a Google Drive file to the local watch folder for processing.
 */
export async function downloadDriveVideo(fileId: string, destPath: string): Promise<void> {
  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  log.step('watcher', `Downloading Drive file (${fileId}) to ${path.basename(destPath)}...`);

  await fsPromises.mkdir(path.dirname(destPath), { recursive: true });

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    const destStream = fs.createWriteStream(destPath);
    response.data
      .on('error', (err) => {
        destStream.close();
        fsPromises.unlink(destPath).catch(() => {});
        reject(new Error(`Drive download stream error: ${err.message}`));
      })
      .pipe(destStream);

    destStream.on('finish', () => {
      destStream.close();
      log.success('watcher', `Download completed successfully.`);
      resolve();
    });

    destStream.on('error', (err) => {
      destStream.close();
      fsPromises.unlink(destPath).catch(() => {});
      reject(err);
    });
  });
}

/**
 * Clean up a temporary local downloaded video file.
 */
export async function cleanupLocalVideo(filePath: string): Promise<void> {
  try {
    await fsPromises.unlink(filePath);
    log.info('watcher', `Cleaned up local video file: ${path.basename(filePath)}`);
  } catch (err: any) {
    log.warn('watcher', `Failed to delete local temporary video file: ${err.message}`);
  }
}
