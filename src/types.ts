/**
 * All shared types for the pipeline — upgraded to match the
 * Academic Quality Auditor rubric.
 */

// ─── Transcript ──────────────────────────────────────────────

export interface TranscriptSegment {
  speaker: string;
  startTime: number;   // seconds
  endTime: number;     // seconds
  text: string;
}

export interface Transcript {
  recordingId: string;
  segments: TranscriptSegment[];
  durationSeconds: number;
  speakers: string[];
  provider: string;
  createdAt: string;
}

// ─── Evaluation ──────────────────────────────────────────────

/** A factual mistake found during the recording audit. */
export interface FactualMistake {
  timestamp: string;          // "MM:SS" format
  teacherStatement: string;
  correctExplanation: string;
  reason: string;
  severity: 'Minor' | 'Moderate' | 'Major';
}

/** Individual score for one of the 20 auditor parameters. */
export interface ParameterEvaluation {
  parameterId: string;
  parameterName: string;
  score: number;              // 1–10
}

/** Scores for the major spreadsheet rating categories. */
export interface RubricScores {
  teachingQuality: number;
  subjectExpertise: number;
  communication: number;
  studentEngagement: number;
  professionalism: number;
  overall: number;            // One decimal place
}

/** Complete evaluation result for one recording. */
export interface EvaluationResult {
  recordingId: string;
  parameters: ParameterEvaluation[];
  factualMistakes: FactualMistake[];
  positiveAreas: string[];     // 4–8 items
  concernAreas: string[];      // genuine areas
  evidenceTimestamps: string[]; // timestamps separated by commas
  recommendations: string[];   // 3–5 recommendations
  scores: RubricScores;
  overallSummary: string;
  visualTimeline?: string;     // Text-based visual timeline from vision model
  model: string;
  createdAt: string;
}

// ─── Recording / Pipeline ────────────────────────────────────

export interface RecordingInfo {
  fileId: string;             // filename used as ID in local mode
  fileName: string;
  filePath: string;
  teacherName?: string;
  studentName?: string;       // student name extracted or placeholder
  subject?: string;
  recordingDate?: string;
  durationSeconds?: number;
}

export interface PipelineResult {
  recording: RecordingInfo;
  transcript: Transcript;
  evaluation: EvaluationResult;
  reportPath: string;
}

// ─── Filename Parser ─────────────────────────────────────────

/**
 * Extract metadata from structured filenames.
 * Supports:
 *   "2026-07-25_MrSmith_Mathematics.mp4" → date + teacher + subject
 *   "2026-07-25_MrSmith_Johnny_Mathematics.mp4" → date + teacher + student + subject
 *   "MrSmith_Mathematics.mp4"            → teacher + subject
 */
export function parseFileName(fileName: string): Pick<RecordingInfo, 'teacherName' | 'studentName' | 'subject' | 'recordingDate'> {
  const base = fileName.replace(/\.[^.]+$/, '');
  const parts = base.split('_');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  let recordingDate: string | undefined;
  let teacherName: string | undefined;
  let studentName: string | undefined;
  let subject: string | undefined;

  if (parts.length >= 4 && datePattern.test(parts[0])) {
    // Format: "2026-07-25_MrSmith_Johnny_Mathematics"
    recordingDate = parts[0];
    teacherName = parts[1];
    studentName = parts[2];
    subject = parts.slice(3).join(' ');
  } else if (parts.length >= 3 && datePattern.test(parts[0])) {
    // Format: "2026-07-25_MrSmith_Mathematics"
    recordingDate = parts[0];
    teacherName = parts[1];
    subject = parts.slice(2).join(' ');
  } else if (parts.length >= 2) {
    // Format: "MrSmith_Mathematics"
    teacherName = parts[0];
    subject = parts.slice(1).join(' ');
  }

  return {
    recordingDate,
    teacherName,
    studentName: studentName || 'Student',
    subject,
  };
}
