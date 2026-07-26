/**
 * Sheet Updater — appends a row to a Google Sheet,
 * with automatic fallback to a local CSV tracking file if not configured.
 * Formatted exactly to the Google Sheets schema requested by the user.
 */

import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { config, getSpreadsheetId } from './config.js';
import { log } from './logger.js';
import { hasGoogleCredentials } from './driveWatcher.js';
import type { RecordingInfo, EvaluationResult } from './types.js';

const CSV_HEADERS = [
  'Teacher',
  'Student',
  'Subject',
  'Class Date',
  'Positive Areas',
  'Concern Areas',
  'Evidence (Timestamp)',
  'Recommendation',
  'Teaching Quality Score',
  'Subject Expertise Score',
  'Communication Score',
  'Student Engagement Score',
  'Professionalism Score',
  'Overall Rating',
  // Helper columns kept at the end
  'Report Link',
  'Transcript Link',
  'Processed At',
];

/** Escape a CSV field (wrap in quotes if it contains commas, quotes, or newlines). */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Append one row to the tracking Google Sheet (or CSV fallback).
 */
export async function updateSheet(
  recording: RecordingInfo,
  evaluation: EvaluationResult,
  reportPath: string,
  transcriptPath: string
): Promise<void> {
  // Extract score values with fallbacks
  const scores = evaluation.scores || {
    teachingQuality: 0,
    subjectExpertise: 0,
    communication: 0,
    studentEngagement: 0,
    professionalism: 0,
    overall: 0,
  };

  // Format list fields as multiline string observations inside a single CSV cell
  const positiveStr = (evaluation.positiveAreas || []).join('\n');
  const concernStr = (evaluation.concernAreas || []).join('\n');
  const evidenceStr = (evaluation.evidenceTimestamps || []).join(', ');
  const recommendationStr = (evaluation.recommendations || []).join('\n');

  // Build the row exactly according to the column specs
  const row = [
    recording.teacherName || 'Unknown',
    recording.studentName || 'Student',
    recording.subject || 'Unknown',
    recording.recordingDate || 'Unknown',
    positiveStr,
    concernStr,
    evidenceStr,
    recommendationStr,
    scores.teachingQuality.toFixed(1),
    scores.subjectExpertise.toFixed(1),
    scores.communication.toFixed(1),
    scores.studentEngagement.toFixed(1),
    scores.professionalism.toFixed(1),
    scores.overall.toFixed(1),
    // Extra helper links at the end
    reportPath,
    transcriptPath,
    new Date().toISOString(),
  ];

  // Try Google Sheets if configured
  const credentialsExist = await hasGoogleCredentials();
  const spreadsheetId = getSpreadsheetId(config.googleSheetUrl);

  if (credentialsExist && spreadsheetId) {
    log.step('sheet', 'Updating Google Sheet...');
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: config.googleCredentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A:Q',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });

      log.success('sheet', `Row successfully appended to Google Sheet.`);
      return;
    } catch (err: any) {
      log.error('sheet', `Failed to write to Google Sheets: ${err.message}`);
      log.info('sheet', 'Falling back to local CSV...');
    }
  } else {
    if (!credentialsExist) {
      log.info('sheet', 'Google credentials file not found. Falling back to local CSV.');
    } else if (!spreadsheetId) {
      log.info('sheet', 'Google Sheet URL not configured or invalid. Falling back to local CSV.');
    }
  }

  // Fallback: Local CSV update
  log.step('sheet', 'Updating local tracking CSV...');

  const csvPath = config.trackingCsvPath;
  await fs.mkdir(path.dirname(csvPath), { recursive: true });

  // Create file with headers if it doesn't exist
  let fileExists = false;
  try {
    await fs.access(csvPath);
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  if (!fileExists) {
    await fs.writeFile(csvPath, CSV_HEADERS.map(csvEscape).join(',') + '\n', 'utf-8');
  }

  // Try appending to the CSV file with retry logic to avoid EBUSY / write locks on Windows
  let attempts = 0;
  while (attempts < 5) {
    try {
      await fs.appendFile(csvPath, row.map(csvEscape).join(',') + '\n', 'utf-8');
      log.success('sheet', `Row appended → ${path.basename(csvPath)}`);
      break;
    } catch (err: any) {
      attempts++;
      if (attempts >= 5) {
        log.error('sheet', `Failed to write to CSV after 5 attempts due to file lock: ${err.message}`);
        throw err;
      }
      log.warn('sheet', `CSV file is busy or locked, retrying in 500ms... (attempt ${attempts}/5)`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

