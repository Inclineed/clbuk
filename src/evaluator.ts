/**
 * Evaluator — sends transcript to local Ollama or Claude
 * using a robust two-step Quality Audit pipeline:
 *   1. Audit Stage: Extracts factual mistakes, positive areas, concern areas, and recommendations.
 *   2. Grading Stage: Evaluates the 20 parameters and calculates spreadsheet rating scores.
 * This split prevents smaller local models (like Llama 3.2 3B) from omitting fields.
 */

import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
import type { Transcript, EvaluationResult, FactualMistake, ParameterEvaluation, RubricScores } from './types.js';

// ─── The 20 Evaluation Parameters ────────────────────────────

const AUDITOR_PARAMETERS = [
  { id: 'lesson_structure', name: 'Lesson Structure & Organization' },
  { id: 'teacher_preparation', name: 'Teacher Preparation' },
  { id: 'subject_knowledge', name: 'Subject Knowledge' },
  { id: 'concept_accuracy', name: 'Concept Accuracy' },
  { id: 'explanation_quality', name: 'Explanation Quality' },
  { id: 'simplify_concepts', name: 'Ability to Simplify Concepts' },
  { id: 'use_examples', name: 'Use of Examples and Analogies' },
  { id: 'student_engagement', name: 'Student Engagement' },
  { id: 'handling_doubts', name: 'Handling Student Doubts' },
  { id: 'pace_of_teaching', name: 'Pace of Teaching' },
  { id: 'communication_skills', name: 'Communication Skills' },
  { id: 'grammar', name: 'Grammar' },
  { id: 'pronunciation', name: 'Pronunciation' },
  { id: 'professionalism', name: 'Professionalism' },
  { id: 'time_utilization', name: 'Time Utilization' },
  { id: 'student_motivation', name: 'Student Motivation' },
  { id: 'homework_discussion', name: 'Homework Discussion' },
  { id: 'lesson_recap', name: 'Lesson Recap' },
  { id: 'technical_issues', name: 'Technical Issues' },
  { id: 'classroom_management', name: 'Classroom Management' },
] as const;

// ─── Format Segments helper ──────────────────────────────────

function formatTranscriptSegments(transcript: Transcript): string {
  return transcript.segments.map(s => {
    const startMin = Math.floor(s.startTime / 60);
    const startSec = Math.floor(s.startTime % 60);
    const ts = `${String(startMin).padStart(2, '0')}:${String(startSec).padStart(2, '0')}`;
    return `[${ts}] ${s.speaker}: ${s.text}`;
  }).join('\n');
}

// ─── STEP 1: Audit Prompt (Factual errors + Observations) ────

async function buildAuditSystemPrompt(): Promise<string> {
  const defaultPrompt = `You are an experienced Academic Quality Auditor. Your job is to audit a classroom transcript and identify observations, factual mistakes, and recommendations.

## Task 1: Factual Accuracy Audit
Identify any conceptual inaccuracies, incorrect formulas, wrong calculations, or incorrect definitions.
- For each mistake, you MUST provide: timestamp (MM:SS), the teacher statement, the correct explanation, the reason it is incorrect, and the severity (Minor, Moderate, Major).
- Crucial: Write a detailed correction. Do not leave "correctExplanation" or "reason" empty.
- If there are no factual mistakes, return "factualMistakes": [].

## Task 2: Positive & Concern Observations
- Identify 4 to 8 positive areas (observations highlighting teacher preparation, subject expertise, communication, engagement, etc.).
- Identify concern areas (genuine improvement areas like technical interruptions, pacing issues, grammar/pronunciation issues, missed opportunities). Do not fabricate concerns.
- List all timestamps related to observations.

## Task 3: Actionable Recommendations
- Provide 3 to 5 actionable recommendations directly addressing the concern areas.

Output your response in raw JSON format matching this exact schema:
{
  "factualMistakes": [
    {
      "timestamp": "MM:SS",
      "teacherStatement": "statement...",
      "correctExplanation": "correction...",
      "reason": "why...",
      "severity": "Minor"
    }
  ],
  "positiveAreas": [
    "Complete observation sentence 1...",
    "Complete observation sentence 2..."
  ],
  "concernAreas": [
    "Complete concern sentence 1...",
    "Complete concern sentence 2..."
  ],
  "evidenceTimestamps": ["MM:SS", "MM:SS"],
  "recommendations": [
    "Actionable recommendation 1...",
    "Actionable recommendation 2..."
  ]
}

CRITICAL RULES:
1. Do NOT include parenthetical helper text, instructions, or label headings (e.g. "Observation 1:") inside your output strings. Just write natural, complete sentences.
2. Every item must be a fully formulated sentence. Do not output empty placeholders.`;

  try {
    const customPromptPath = path.join(root, 'prompts', 'eval_audit.txt');
    const content = await fs.readFile(customPromptPath, 'utf-8');
    if (content.trim()) {
      return content.trim();
    }
  } catch {
    // Fallback to default
  }
  return defaultPrompt;
}

// ─── STEP 2: Grading Prompt (Rubric scores + Summary) ────────

async function buildGradingSystemPrompt(auditResultsStr: string): Promise<string> {
  const parametersList = AUDITOR_PARAMETERS.map((p, i) => `${i + 1}. ${p.name} (id: "${p.id}")`).join('\n');

  const defaultPrompt = `You are an experienced Academic Quality Auditor. Evaluate the teacher on the 20 parameters below, and calculate spreadsheet scores.
Base your scores on the transcript and the Audit Findings provided.

## Audit Findings for reference:
{{AUDIT_FINDINGS}}

## 20 Parameters to Evaluate (Rate each 1 to 10):
{{PARAMETERS_LIST}}

## Google Sheets Score Grouping (each 1 to 10):
1. **Teaching Quality Score**
2. **Subject Expertise Score**
3. **Communication Score**
4. **Student Engagement Score**
5. **Professionalism Score**
6. **Overall Rating** (Overall rating, one decimal place. Guidelines: 9.5-10 = Outstanding, 9.0-9.4 = Excellent, 8.0-8.9 = Very Good, 7.0-7.9 = Good, 6.0-6.9 = Needs Improvement, Below 6 = Unsatisfactory)

Output your response in raw JSON format matching this exact schema:
{
  "parameters": [
    { "parameterId": "lesson_structure", "parameterName": "Lesson Structure & Organization", "score": 8 }
  ],
  "scores": {
    "teachingQuality": 8.0,
    "subjectExpertise": 8.0,
    "communication": 8.0,
    "studentEngagement": 7.0,
    "professionalism": 9.0,
    "overall": 8.0
  },
  "overallSummary": "High-level summary of the class assessment..."
}

CRITICAL RULES:
1. Assign a score 1-10 for ALL 20 parameters.
2. Calculate the overall rating using one decimal place.
3. Make sure the overallSummary is a concise paragraph describing the teacher's performance.`;

  let prompt = defaultPrompt;
  try {
    const customPromptPath = path.join(root, 'prompts', 'eval_grading.txt');
    const content = await fs.readFile(customPromptPath, 'utf-8');
    if (content.trim()) {
      prompt = content.trim();
    }
  } catch {
    // Fallback to default
  }

  // Replace placeholders dynamically
  prompt = prompt.replace('{{AUDIT_FINDINGS}}', auditResultsStr);
  prompt = prompt.replace('{{PARAMETERS_LIST}}', parametersList);

  return prompt;
}

// ─── Mock Evaluator ──────────────────────────────────────────

function generateMockEvaluation(recordingId: string): Omit<EvaluationResult, 'recordingId' | 'model' | 'createdAt'> {
  const scores: RubricScores = {
    teachingQuality: 8.0,
    subjectExpertise: 8.5,
    communication: 7.5,
    studentEngagement: 7.0,
    professionalism: 9.0,
    overall: 8.0,
  };

  const parameters: ParameterEvaluation[] = AUDITOR_PARAMETERS.map(p => ({
    parameterId: p.id,
    parameterName: p.name,
    score: Math.round((7 + Math.random() * 2.5) * 10) / 10,
  }));

  const factualMistakes: FactualMistake[] = [
    {
      timestamp: '03:59',
      teacherStatement: 'And we will also look at the tradeoff or the diagram between the velocity and the load factor called as the V and diagram.',
      correctExplanation: 'It is called the V-n diagram, representing Velocity (V) and Load Factor (n).',
      reason: 'The teacher pronounced "V-n" as "V and", confusing the variable "n" with the word "and".',
      severity: 'Minor',
    }
  ];

  return {
    parameters,
    factualMistakes,
    positiveAreas: [
      'Subject expertise was evident in linear equations review.',
      'Clear explanation of the y = mx + b components.',
      'Prompt response and explanation when the student asked about negative slopes.',
      'Good pacing during the initial explanation phase.',
      'Professional demeanor and welcoming class opening.',
    ],
    concernAreas: [
      'Missed opportunity to ask diagnostic questions before starting the review.',
      'Long pause before reviewing the practice problem.',
    ],
    evidenceTimestamps: ['00:35', '03:59', '05:00'],
    recommendations: [
      'Structure lesson recaps more formally at the end of class.',
      'Encourage student questions during slide transitions.',
      'Verify technical terms and spellings beforehand to avoid pronunciation slip-ups.',
    ],
    scores,
    overallSummary: 'The session was a very good introductory class showing solid subject command. Pacing was mostly appropriate, with constructive responses to student queries.',
  };
}

// ─── Claude API Helpers ──────────────────────────────────────

async function callClaude(systemPrompt: string, userPrompt: string): Promise<any> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in Claude response');
  }

  let jsonStr = textBlock.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  return JSON.parse(jsonStr.trim());
}

// ─── Network Request Helpers ─────────────────────────────────

function requestPost(urlStr: string, headers: Record<string, string>, body: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP/S Error (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

// ─── Ollama API Helpers ──────────────────────────────────────

async function callOllama(systemPrompt: string, userPrompt: string): Promise<any> {
  const endpoint = `${config.ollamaUrl}/api/chat`;

  const requestBody = {
    model: config.ollamaModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    format: 'json',
    stream: false,
    options: {
      temperature: 0.1,
      num_ctx: 16384, // Ensure context window is large enough for transcripts
    }
  };

  const responseText = await requestPost(endpoint, {}, requestBody);
  const data = JSON.parse(responseText);
  const jsonContent = data.message?.content;

  if (!jsonContent) {
    throw new Error(`Ollama returned an empty response. Response data: ${responseText}`);
  }

  return JSON.parse(jsonContent.trim());
}

// ─── OpenAI API Helpers ──────────────────────────────────────

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<any> {
  const url = 'https://api.openai.com/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${config.openaiApiKey}`,
  };
  const body = {
    model: config.openaiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  const responseText = await requestPost(url, headers, body);
  const data = JSON.parse(responseText);
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI returned empty response. Response: ${responseText}`);
  }
  return JSON.parse(content.trim());
}

// ─── Gemini API Helpers ──────────────────────────────────────

async function callGemini(systemPrompt: string, userPrompt: string): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const headers = {};
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        { text: systemPrompt }
      ]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    }
  };

  const responseText = await requestPost(url, headers, body);
  const data = JSON.parse(responseText);
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error(`Gemini returned empty response. Response: ${responseText}`);
  }
  return JSON.parse(content.trim());
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Evaluate a transcript against the teaching rubric.
 */
export async function evaluate(
  recordingId: string,
  transcript: Transcript,
  visualTimeline?: string
): Promise<{ evaluation: EvaluationResult; evaluationPath: string }> {
  log.step('evaluate', `Provider: ${config.evaluationProvider}`);

  // Handle empty transcript immediately
  if (transcript.segments.length === 0) {
    log.warn('evaluate', 'Transcript is empty. Skipping LLM calls.');
    
    const evaluation: EvaluationResult = {
      recordingId,
      parameters: AUDITOR_PARAMETERS.map(p => ({
        parameterId: p.id,
        parameterName: p.name,
        score: 0,
      })),
      factualMistakes: [],
      positiveAreas: ['No observations possible due to lack of speech in recording.'],
      concernAreas: ['No speech detected in this recording.'],
      evidenceTimestamps: [],
      recommendations: ['Provide a class recording with audible speech.'],
      scores: {
        teachingQuality: 0,
        subjectExpertise: 0,
        communication: 0,
        studentEngagement: 0,
        professionalism: 0,
        overall: 0,
      },
      overallSummary: 'No speech was detected in this recording.',
      visualTimeline,
      model: 'none',
      createdAt: new Date().toISOString(),
    };

    const evalDir = path.join(config.workingDir, recordingId);
    await fs.mkdir(evalDir, { recursive: true });
    const evaluationPath = path.join(evalDir, 'evaluation.json');
    await fs.writeFile(evaluationPath, JSON.stringify(evaluation, null, 2));
    log.success('evaluate', `Evaluation saved → ${path.basename(evaluationPath)}`);

    return { evaluation, evaluationPath };
  }

  let finalResult: Omit<EvaluationResult, 'recordingId' | 'model' | 'createdAt'>;

  try {
    const formattedTranscript = formatTranscriptSegments(transcript);
    
    let userPrompt = '';
    if (visualTimeline && visualTimeline.includes('[SPEECH')) {
      // Multimodal timeline: interleaved visual + speech events
      userPrompt += `Here is the time-synchronized classroom recording analysis (duration: ${Math.round(transcript.durationSeconds / 60)}m, speakers: ${transcript.speakers.join(', ')}):\n\n${visualTimeline}`;
    } else if (visualTimeline) {
      // Legacy format: separate visual timeline + transcript
      userPrompt += `Here is the Visual Timeline of the video recording:\n${visualTimeline}\n\n`;
      userPrompt += `Here is the verbal classroom transcript to audit (duration: ${Math.round(transcript.durationSeconds / 60)}m, speakers: ${transcript.speakers.join(', ')}):\n\n${formattedTranscript}`;
    } else {
      // Audio only: no visual data
      userPrompt += `Here is the verbal classroom transcript to audit (duration: ${Math.round(transcript.durationSeconds / 60)}m, speakers: ${transcript.speakers.join(', ')}):\n\n${formattedTranscript}`;
    }

    if (config.evaluationProvider === 'anthropic') {
      // Step 1: Audit
      log.info('evaluate', 'Step 1/2: Running Audit Stage with Claude...');
      const auditResult = await callClaude(await buildAuditSystemPrompt(), userPrompt);
      
      // Step 2: Grading
      log.info('evaluate', 'Step 2/2: Running Grading Stage with Claude...');
      const gradingPrompt = await buildGradingSystemPrompt(JSON.stringify(auditResult, null, 2));
      const gradingResult = await callClaude(gradingPrompt, userPrompt);

      finalResult = {
        ...auditResult,
        ...gradingResult
      };
    } else if (config.evaluationProvider === 'openai') {
      // Step 1: Audit
      log.info('evaluate', 'Step 1/2: Running Audit Stage with OpenAI...');
      const auditResult = await callOpenAI(await buildAuditSystemPrompt(), userPrompt);
      
      // Step 2: Grading
      log.info('evaluate', 'Step 2/2: Running Grading Stage with OpenAI...');
      const gradingPrompt = await buildGradingSystemPrompt(JSON.stringify(auditResult, null, 2));
      const gradingResult = await callOpenAI(gradingPrompt, userPrompt);

      finalResult = {
        ...auditResult,
        ...gradingResult
      };
    } else if (config.evaluationProvider === 'gemini') {
      // Step 1: Audit
      log.info('evaluate', 'Step 1/2: Running Audit Stage with Gemini...');
      const auditResult = await callGemini(await buildAuditSystemPrompt(), userPrompt);
      
      // Step 2: Grading
      log.info('evaluate', 'Step 2/2: Running Grading Stage with Gemini...');
      const gradingPrompt = await buildGradingSystemPrompt(JSON.stringify(auditResult, null, 2));
      const gradingResult = await callGemini(gradingPrompt, userPrompt);

      finalResult = {
        ...auditResult,
        ...gradingResult
      };
    } else if (config.evaluationProvider === 'local') {
      // Step 1: Audit
      log.info('evaluate', 'Step 1/2: Running Audit Stage with local Ollama...');
      const auditResult = await callOllama(await buildAuditSystemPrompt(), userPrompt);
      
      // Step 2: Grading
      log.info('evaluate', 'Step 2/2: Running Grading Stage with local Ollama...');
      const gradingPrompt = await buildGradingSystemPrompt(JSON.stringify(auditResult, null, 2));
      const gradingResult = await callOllama(gradingPrompt, userPrompt);

      // Map severity values to correct types if the model returned numbers
      if (auditResult.factualMistakes) {
        auditResult.factualMistakes = auditResult.factualMistakes.map((m: any) => {
          let severity: 'Minor' | 'Moderate' | 'Major' = 'Minor';
          if (m.severity === 2 || m.severity === 'Moderate' || m.severity === '2') severity = 'Moderate';
          if (m.severity === 3 || m.severity === 'Major' || m.severity === '3' || m.severity === 4 || m.severity === '4') severity = 'Major';
          return { ...m, severity };
        });
      }

      finalResult = {
        ...auditResult,
        ...gradingResult
      };
    } else {
      log.info('evaluate', 'Using mock evaluator');
      finalResult = generateMockEvaluation(recordingId);
    }

    const evaluation: EvaluationResult = {
      ...finalResult,
      recordingId,
      visualTimeline,
      model: config.evaluationProvider === 'local' 
        ? `ollama-${config.ollamaModel}` 
        : config.evaluationProvider === 'anthropic' 
          ? config.anthropicModel 
          : config.evaluationProvider === 'openai'
            ? config.openaiModel
            : config.evaluationProvider === 'gemini'
              ? config.geminiModel
              : 'mock',
      createdAt: new Date().toISOString(),
    };

    // Save evaluation JSON
    const evalDir = path.join(config.workingDir, recordingId);
    await fs.mkdir(evalDir, { recursive: true });
    const evaluationPath = path.join(evalDir, 'evaluation.json');
    await fs.writeFile(evaluationPath, JSON.stringify(evaluation, null, 2));
    log.success('evaluate', `Evaluation saved → ${path.basename(evaluationPath)}`);

    return { evaluation, evaluationPath };

  } catch (error) {
    log.error('evaluate', `Evaluation pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
