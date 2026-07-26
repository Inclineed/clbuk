/**
 * Timeline Builder — merges visual frame descriptions and transcript segments
 * into a single time-synchronized multimodal document.
 *
 * The output interleaves [VISUAL] and [SPEECH] entries chronologically,
 * grouping speech segments under the visual context that was active at
 * that point in the recording.
 */

import type { Transcript, TranscriptSegment } from './types.js';

// ─── Types ───────────────────────────────────────────────────

export interface AnalyzedFrame {
  /** Timestamp in seconds within the video. */
  timestampSeconds: number;
  /** Vision LLM description of this frame. */
  description: string;
  /** Pixel-diff change score (informational). */
  changeScore: number;
}

interface TimelineEvent {
  timestampSeconds: number;
  type: 'visual' | 'speech';
  /** For visual events: the description. For speech: speaker + text. */
  content: string;
  /** For speech events: end time in seconds. */
  endSeconds?: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Build a time-synchronized multimodal timeline from analyzed frames
 * and transcript segments.
 *
 * Groups consecutive speech segments under the visual context that was
 * active at that point (i.e., the most recent visual change event).
 */
export function buildMultimodalTimeline(
  frames: AnalyzedFrame[],
  transcript: Transcript
): string {
  // Merge all events into a single sorted array
  const events: TimelineEvent[] = [];

  // Add visual change events
  for (const frame of frames) {
    events.push({
      timestampSeconds: frame.timestampSeconds,
      type: 'visual',
      content: frame.description,
    });
  }

  // Add speech events
  for (const seg of transcript.segments) {
    const speaker = seg.speaker || 'Speaker';
    events.push({
      timestampSeconds: seg.startTime,
      type: 'speech',
      content: `${speaker}: "${seg.text.trim()}"`,
      endSeconds: seg.endTime,
    });
  }

  // Sort by timestamp (visual events come first at same timestamp)
  events.sort((a, b) => {
    if (a.timestampSeconds !== b.timestampSeconds) {
      return a.timestampSeconds - b.timestampSeconds;
    }
    // Visual events before speech at the same timestamp
    return a.type === 'visual' ? -1 : 1;
  });

  // Build the formatted output, grouping by visual context sections
  const lines: string[] = [];
  let currentVisualContext: string | null = null;
  let sectionStartTime = 0;

  for (const event of events) {
    if (event.type === 'visual') {
      // Start a new visual context section
      const ts = formatTimestamp(event.timestampSeconds);

      // Close previous section with a separator
      if (currentVisualContext !== null) {
        lines.push('');
      }

      lines.push(`═══ ${ts} ═══`);

      if (event.timestampSeconds === 0) {
        lines.push(`[VISUAL] ${event.content}`);
      } else {
        lines.push(`[VISUAL CHANGE] ${event.content}`);
      }

      currentVisualContext = event.content;
      sectionStartTime = event.timestampSeconds;

    } else if (event.type === 'speech') {
      const startTs = formatTimestamp(event.timestampSeconds);
      const endTs = event.endSeconds ? formatTimestamp(event.endSeconds) : startTs;
      lines.push(`[SPEECH ${startTs}-${endTs}] ${event.content}`);
    }
  }

  // If there were no visual frames at all, just format the transcript
  if (frames.length === 0) {
    const fallbackLines: string[] = [];
    for (const seg of transcript.segments) {
      const startTs = formatTimestamp(seg.startTime);
      const endTs = formatTimestamp(seg.endTime);
      const speaker = seg.speaker || 'Speaker';
      fallbackLines.push(`[SPEECH ${startTs}-${endTs}] ${speaker}: "${seg.text.trim()}"`);
    }
    return fallbackLines.join('\n');
  }

  return lines.join('\n');
}
