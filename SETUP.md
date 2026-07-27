# 🚀 Setup Guide: Classsbuk Transcript AI Reviewer (Drive Edition)

Welcome to the **Classsbuk Transcript AI Reviewer**. This branch of the project is a simplified, high-efficiency pipeline that automatically downloads class transcript files (JSON, TXT, or Google Docs) from Google Drive, parses them, and generates structured academic quality audit reports using local or cloud AI models.

Since this version analyzes transcript text directly, **no audio extraction, video processing, or video-to-text transcription is required.**

---

## 🛠️ Prerequisites

Before you start, ensure you have the following installed on your system:

1. **[Node.js](https://nodejs.org/)** (v18 or higher recommended)
2. **[Ollama](https://ollama.com/)** (Required only if running evaluations locally without an API key)

*Note: Python, FFmpeg, and Whisper are NOT required for this transcript-only pipeline.*

---

## 📦 1. Installation

1. **Clone the repository and checkout the branch:**
   ```bash
   git clone https://github.com/Inclineed/clbuk.git
   cd clbuk
   git checkout feature/drive-transcript-analysis
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

---

## 🧠 2. LLM Provider Setup

You can run evaluations using either a local LLM or Anthropic's Claude:

### Option A: Cloud LLM (Claude) - Recommended
Simply configure your `ANTHROPIC_API_KEY` in the `.env` file. The system will automatically detect the key and use Claude for all evaluations.

### Option B: Local LLM (Ollama)
If no API key is provided, the system defaults to Ollama:
1. Start the Ollama server:
   ```bash
   ollama serve
   ```
2. Pull the default language model:
   ```bash
   ollama pull llama3.1
   ```

---

## ⚙️ 3. Configuration

1. **Create the Environment File:**
   Copy the example configuration file to create your active `.env` file:
   ```bash
   cp .env.example .env
   ```

2. **Configure `.env` variables:**
   Open `.env` in your text editor. Key variables to note:
   - `ANTHROPIC_API_KEY`: Paste your Claude API key here to automatically use cloud evaluation.
   - `EVALUATION_PROVIDER`: Defaults to `local` (uses Ollama), but automatically overrides to `anthropic` if an API key is detected.
   - `OLLAMA_MODEL`: Set to `llama3.1` (if using Ollama).

3. **Google Drive Integration:**
   - Obtain a Google Service Account JSON key.
   - Save it as `google-credentials.json` in the project root.
   - Fill in `GOOGLE_DRIVE_FOLDER_URL` (folder containing transcripts) and `GOOGLE_SHEET_URL` (tracking sheet) in the `.env` file.

---

## ▶️ 4. Running the Pipeline

You can run the pipeline in two modes:

### Watch Mode (Continuous Polling)
The system will run continuously, checking the configured Google Drive folder (or local `data/watch` folder) every 30 seconds for new transcripts.
```bash
npm start
```

### Single Run Mode
If you want to process existing transcripts in the watch folder and then exit immediately:
```bash
npm run process
```

---

## 📂 5. Output Architecture

When a transcript is processed, the system creates the following artifacts:

- **`data/watch/`**: Drop transcript files here (in `.txt` or `.json` format) if not using Google Drive.
- **`data/transcripts/`**: Saves structured, timestamped `.json` representations of all parsed transcripts.
- **`data/reports/`**: The final Markdown (`.md`) quality audit reports containing factual accuracy audits, rubric scores, and recommendations.

---

> **Tip:** The transcript parser is highly robust! It automatically parses files formatted as `[MM:SS] Speaker: text`, `Speaker: text`, or raw plain text (estimating timestamps and speakers). If a Google Doc is scanned in Google Drive, the system automatically exports and downloads it as a plain-text transcript file!
