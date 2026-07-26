/**
 * Report Generator — creates a readable markdown report from evaluation results.
 * Upgraded for the Academic Quality Auditor rubric.
 */

import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { log } from './logger.js';
import type { RecordingInfo, EvaluationResult, Transcript } from './types.js';

/** Format seconds as "MM:SS" or "H:MM:SS". */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Generate a score bar like "████████░░ 8.0/10". */
function scoreBar(score: number | undefined): string {
  const s = typeof score === 'number' && !isNaN(score) ? score : 0;
  const filled = Math.round(s);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${s.toFixed(1)}/10`;
}

/** Get a rating label from a score. */
function ratingLabel(score: number | undefined): string {
  const s = typeof score === 'number' && !isNaN(score) ? score : 0;
  if (s >= 9.5) return '👑 Outstanding';
  if (s >= 9.0) return '🟢 Excellent';
  if (s >= 8.0) return '🟢 Very Good';
  if (s >= 7.0) return '🟢 Good';
  if (s >= 6.0) return '🟡 Needs Improvement';
  return '🔴 Unsatisfactory';
}

/**
 * Generate a markdown report and save it to disk.
 * Returns the path to the saved report.
 */
export async function generateReport(
  recording: RecordingInfo,
  evaluation: EvaluationResult,
  transcript: Transcript,
  transcriptPath: string
): Promise<string> {
  log.step('report', 'Generating markdown report...');

  const duration = recording.durationSeconds
    ? formatDuration(recording.durationSeconds)
    : 'Unknown';

  const overallSummary = evaluation.overallSummary || 'No summary available.';
  const positiveAreas = evaluation.positiveAreas || [];
  const concernAreas = evaluation.concernAreas || [];
  const recommendations = evaluation.recommendations || [];
  const parameters = evaluation.parameters || [];
  const factualMistakes = evaluation.factualMistakes || [];
  const rubricScores = evaluation.scores || {
    teachingQuality: 0,
    subjectExpertise: 0,
    communication: 0,
    studentEngagement: 0,
    professionalism: 0,
    overall: 0,
  };

  // ─── Build the report ────────────────────────────────

  let report = `# 📋 Class Academic Quality Audit Report

---

## Session Information

| Field | Value |
|-------|-------|
| **Teacher** | ${recording.teacherName || 'Unknown'} |
| **Student** | ${recording.studentName || 'Student'} |
| **Subject** | ${recording.subject || 'Unknown'} |
| **Date** | ${recording.recordingDate || 'Unknown'} |
| **Duration** | ${duration} |
| **File** | ${recording.fileName} |
| **Evaluated** | ${new Date(evaluation.createdAt).toLocaleString()} |
| **Auditor Engine** | ${evaluation.model} |

---

## Overall Assessment

### Overall Rating: ${scoreBar(rubricScores.overall)} — ${ratingLabel(rubricScores.overall)}

${overallSummary}

### 💪 Positive Areas
${positiveAreas.length > 0 ? positiveAreas.map(s => `- ${s}`).join('\n') : '_None identified._'}

### 📈 Concern Areas
${concernAreas.length > 0 ? concernAreas.map(a => `- ${a}`).join('\n') : '_None identified._'}

---

## Factual Accuracy Audit
`;

  if (factualMistakes.length === 0) {
    report += `\n**No factual inaccuracies observed.**\n`;
  } else {
    report += `\nThe following factual inaccuracies / errors were observed during the class audit:\n\n`;
    report += `| Timestamp | Teacher's Statement | Correct Explanation | Reason | Severity |\n`;
    report += `|-----------|--------------------|---------------------|--------|----------|\n`;
    for (const m of factualMistakes) {
      const ts = m.timestamp || '00:00';
      const stmt = (m.teacherStatement || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const correct = (m.correctExplanation || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const reason = (m.reason || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const severity = m.severity || 'Minor';
      report += `| **[${ts}]** | ${stmt} | ${correct} | ${reason} | **${severity}** |\n`;
    }
  }

  if (evaluation.visualTimeline) {
    report += `
---

## Visual Timeline Audit
The following visual milestones were analyzed by the local Vision LLM:

\`\`\`text
${evaluation.visualTimeline}
\`\`\`
`;
  }

  report += `
---

## Rubric Scores

### Score Group Summary

| Score Parameter Group | Rating Score |
|-----------------------|--------------|
| Teaching Quality Score | ${rubricScores.teachingQuality.toFixed(1)}/10 |
| Subject Expertise Score | ${rubricScores.subjectExpertise.toFixed(1)}/10 |
| Communication Score | ${rubricScores.communication.toFixed(1)}/10 |
| Student Engagement Score | ${rubricScores.studentEngagement.toFixed(1)}/10 |
| Professionalism Score | ${rubricScores.professionalism.toFixed(1)}/10 |
| **Overall Rating** | **${rubricScores.overall.toFixed(1)}/10** |

### Individual Parameter Ratings (20 Audit Items)

`;

  for (const param of parameters) {
    report += `- **${param.parameterName || 'Unknown Parameter'}**: ${scoreBar(param.score)}\n`;
  }

  report += `
---

## Actionable Recommendations
${recommendations.length > 0 ? recommendations.map(r => `- ${r}`).join('\n') : '_No specific recommendations._'}

\n---\n\n_Report generated by Classsbuk Academic Quality Auditor System_\n`;

  // ─── Save ───────────────────────────────────────────

  await fs.mkdir(config.reportsDir, { recursive: true });
  const reportFileName = `${recording.fileId.replace(/\.[^.]+$/, '')}_report.md`;
  const reportPath = path.join(config.reportsDir, reportFileName);
  await fs.writeFile(reportPath, report, 'utf-8');

  log.success('report', `Report saved → ${reportFileName}`);
  return reportPath;
}
