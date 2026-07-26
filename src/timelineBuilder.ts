/**
 * Timeline Builder — merges structured visual events and transcript segments
 * into a single time-synchronized multimodal document.
 *
 * The output interleaves visual event markers and speech entries chronologically,
 * grouping speech segments under the visual context that was active at
 * that point in the recording.
 */

import type { Transcript } from './types.js';
import type { VisualEvent, VisualEventType } from './visualEventDetector.js';

// ─── Types ───────────────────────────────────────────────────

/** Re-export for backward compatibility with pipeline. */
export type { VisualEvent };

interface TimelineEvent {
  timestampSeconds: number;
  type: 'visual' | 'speech';
  content: string;
  endSeconds?: number;
  eventType?: VisualEventType;
  visibleContent?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Build a time-synchronized multimodal timeline from structured visual events
 * and transcript segments.
 *
 * Groups consecutive speech segments under the visual context that was
 * active at that point (i.e., the most recent visual event).
 */
export function buildMultimodalTimeline(
  events: VisualEvent[],
  transcript: Transcript
): string {
  // Merge all events into a single sorted array
  const allEvents: TimelineEvent[] = [];

  // Add visual events
  for (const ve of events) {
    allEvents.push({
      timestampSeconds: ve.timestampSeconds,
      type: 'visual',
      content: ve.description,
      eventType: ve.eventType,
      visibleContent: ve.visibleContent,
    });
  }

  // Add speech events
  for (const seg of transcript.segments) {
    const speaker = seg.speaker || 'Speaker';
    allEvents.push({
      timestampSeconds: seg.startTime,
      type: 'speech',
      content: `${speaker}: "${seg.text.trim()}"`,
      endSeconds: seg.endTime,
    });
  }

  // Sort by timestamp (visual events come first at same timestamp)
  allEvents.sort((a, b) => {
    if (a.timestampSeconds !== b.timestampSeconds) {
      return a.timestampSeconds - b.timestampSeconds;
    }
    return a.type === 'visual' ? -1 : 1;
  });

  // Build the formatted output
  const lines: string[] = [];
  let hasVisualContext = false;

  for (const event of allEvents) {
    if (event.type === 'visual') {
      // Start a new visual context section
      const ts = formatTimestamp(event.timestampSeconds);

      if (hasVisualContext) {
        lines.push('');
      }

      lines.push(`═══ ${ts} ═══`);

      // Use structured event type
      const eventTag = event.eventType || 'OTHER';
      if (event.timestampSeconds === 0) {
        lines.push(`[${eventTag}] ${event.content}`);
      } else {
        lines.push(`[${eventTag}] ${event.content}`);
      }

      // Include visible content if present
      if (event.visibleContent) {
        lines.push(`  Content: "${event.visibleContent}"`);
      }

      hasVisualContext = true;

    } else if (event.type === 'speech') {
      const startTs = formatTimestamp(event.timestampSeconds);
      const endTs = event.endSeconds ? formatTimestamp(event.endSeconds) : startTs;
      lines.push(`[SPEECH ${startTs}-${endTs}] ${event.content}`);
    }
  }

  // If there were no visual events, just format the transcript
  if (events.length === 0) {
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
