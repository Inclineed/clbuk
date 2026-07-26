/**
 * Transcriber — converts audio to diarized, timestamped text.
 * Supports:
 *   - "mock" (returns fixture data)
 *   - "assemblyai" (real cloud API)
 *   - "local" (runs faster-whisper via local python virtual env)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { config } from './config.js';
import { log } from './logger.js';
import type { Transcript, TranscriptSegment } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// ─── Mock Transcriber ────────────────────────────────────────

function generateMockTranscript(recordingId: string, durationSeconds: number): Transcript {
  const segments: TranscriptSegment[] = [
    { speaker: 'Teacher', startTime: 5, endTime: 35, text: 'Good morning everyone. Today we are going to discuss the fundamentals of algebra. Please open your textbooks to chapter three.' },
    { speaker: 'Teacher', startTime: 36, endTime: 70, text: 'Let\'s start by reviewing what we learned last week about linear equations. Can anyone tell me the general form of a linear equation?' },
    { speaker: 'Student A', startTime: 72, endTime: 82, text: 'Is it y equals mx plus b?' },
    { speaker: 'Teacher', startTime: 83, endTime: 130, text: 'Exactly right! y = mx + b is the slope-intercept form. M represents the slope, which tells us how steep the line is, and b is the y-intercept, where the line crosses the y-axis.' },
    { speaker: 'Teacher', startTime: 132, endTime: 180, text: 'Now let me show you an example. If we have the equation y = 2x + 3, the slope is 2, meaning for every one unit we move right, the line goes up by 2 units. The y-intercept is 3.' },
    { speaker: 'Student B', startTime: 182, endTime: 195, text: 'What happens if the slope is negative? Does the line go down?' },
    { speaker: 'Teacher', startTime: 196, endTime: 240, text: 'Great question! Yes, when the slope is negative, the line goes downward from left to right. For example, y = -x + 5 would slope downward. Let me draw this on the board.' },
    { speaker: 'Teacher', startTime: 250, endTime: 310, text: 'Now I want you all to try a practice problem. Find the slope and y-intercept of y = 3x - 7. Take a minute to work it out, then we\'ll discuss.' },
    { speaker: 'Teacher', startTime: 380, endTime: 420, text: 'Alright, who would like to share their answer? What is the slope and what is the y-intercept?' },
    { speaker: 'Student A', startTime: 422, endTime: 435, text: 'The slope is 3 and the y-intercept is negative 7.' },
    { speaker: 'Teacher', startTime: 436, endTime: 490, text: 'Perfect! The slope is 3 and the y-intercept is -7. Notice that the sign in front of the number matters. Let\'s move on to our next topic: solving systems of equations.' },
    { speaker: 'Teacher', startTime: 495, endTime: 560, text: 'A system of equations is when we have two or more equations that we need to solve together. There are several methods: substitution, elimination, and graphing. Today we\'ll focus on substitution.' },
  ];

  return {
    recordingId,
    segments,
    durationSeconds,
    speakers: ['Teacher', 'Student A', 'Student B'],
    provider: 'mock',
    createdAt: new Date().toISOString(),
  };
}

// ─── AssemblyAI Transcriber ──────────────────────────────────

async function transcribeWithAssemblyAI(audioPath: string, recordingId: string, durationSeconds: number): Promise<Transcript> {
  const { AssemblyAI } = await import('assemblyai');
  const client = new AssemblyAI({ apiKey: config.assemblyaiApiKey });

  log.step('transcribe', 'Uploading audio to AssemblyAI...');

  const transcript = await client.transcripts.transcribe({
    audio: audioPath,
    speaker_labels: true,
  });

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI error: ${transcript.error}`);
  }

  const segments: TranscriptSegment[] = (transcript.utterances || []).map(u => ({
    speaker: `Speaker ${u.speaker}`,
    startTime: u.start / 1000,
    endTime: u.end / 1000,
    text: u.text,
  }));

  log.success('transcribe', `Got ${segments.length} segments from AssemblyAI`);

  return {
    recordingId,
    segments,
    durationSeconds,
    speakers: [...new Set(segments.map(s => s.speaker))],
    provider: 'assemblyai',
    createdAt: new Date().toISOString(),
  };
}

// ─── Local Whisper Transcriber ────────────────────────────────

function transcribeLocally(audioPath: string, recordingId: string): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    log.step('transcribe', `Starting local transcription using Whisper model: "${config.whisperModelSize}"...`);

    // Path to the python interpreter in virtual env
    let pythonExecutable = path.resolve(root, '.venv-whisper/Scripts/python.exe');
    const scriptPath = path.resolve(root, 'src/transcribe_local.py');

    // Check if virtual env exists; if not, fall back to global python
    fs.access(pythonExecutable)
      .catch(() => {
        log.warn('transcribe', 'Local virtual environment not found. Falling back to global "python".');
        pythonExecutable = 'python';
      })
      .then(() => {
        const args = [scriptPath, '--audio', audioPath, '--model', config.whisperModelSize];

        execFile(pythonExecutable, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            log.error('transcribe', `Local Whisper failed: ${stderr || error.message}`);
            return reject(new Error(stderr || error.message));
          }

          try {
            const parsed = JSON.parse(stdout);
            
            // Map segments output to our Transcript format
            const segments: TranscriptSegment[] = parsed.segments;
            
            log.success('transcribe', `Local Whisper finished. Got ${segments.length} segments.`);
            
            resolve({
              recordingId,
              segments,
              durationSeconds: parsed.durationSeconds,
              speakers: [...new Set(segments.map(s => s.speaker))],
              provider: `local-whisper-${config.whisperModelSize}`,
              createdAt: new Date().toISOString(),
            });
          } catch (parseErr) {
            log.error('transcribe', `Failed to parse Python output: ${stdout}`);
            reject(parseErr);
          }
        });
      });
  });
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Transcribe an audio file and save the result.
 */
export async function transcribe(
  recordingId: string,
  audioPath: string,
  durationSeconds: number
): Promise<{ transcript: Transcript; transcriptPath: string }> {
  log.step('transcribe', `Provider: ${config.transcriptionProvider}`);

  let transcript: Transcript;

  if (config.transcriptionProvider === 'assemblyai') {
    transcript = await transcribeWithAssemblyAI(audioPath, recordingId, durationSeconds);
  } else if (config.transcriptionProvider === 'local') {
    transcript = await transcribeLocally(audioPath, recordingId);
  } else {
    log.info('transcribe', 'Using mock transcriber');
    transcript = generateMockTranscript(recordingId, durationSeconds);
  }

  // Save transcript JSON
  await fs.mkdir(config.transcriptsDir, { recursive: true });
  const transcriptPath = path.join(config.transcriptsDir, `${recordingId}.json`);
  await fs.writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
  log.success('transcribe', `Transcript saved → ${path.basename(transcriptPath)}`);

  return { transcript, transcriptPath };
}
