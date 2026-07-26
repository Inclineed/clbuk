# 🚀 Setup Guide: Classsbuk Video AI Reviewer

Welcome to the **Classsbuk AI Class Recording Reviewer**. This project automatically downloads educational videos from Google Drive, transcribes the audio, analyzes visual frames using a content-aware event detector, and generates a structured academic quality audit report using local or cloud AI models.

Follow this guide to get the system running locally from scratch.

---

## 🛠️ Prerequisites

Before you start, ensure you have the following installed on your system:

1. **[Node.js](https://nodejs.org/)** (v18 or higher recommended)
2. **[Python](https://www.python.org/downloads/)** (v3.9 or higher, required for local Whisper transcription)
3. **[FFmpeg](https://ffmpeg.org/download.html)** (Required for audio/video frame extraction)
   - *Ensure `ffmpeg` is added to your system's PATH.*
4. **[Ollama](https://ollama.com/)** (Required for local LLM inference)

---

## 📦 1. Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Inclineed/clbuk.git
   cd clbuk
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Install Local AI dependencies (Optional but recommended):**
   If you plan to use local transcription (`TRANSCRIPTION_PROVIDER=local`), you need to set up the Python environment for `faster-whisper`.
   Run the provided PowerShell script:
   ```powershell
   .\scripts\setup-local-ai.ps1
   ```
   *(This will create a `.venv-whisper` virtual environment and install necessary Python packages).*

---

## 🧠 2. Setting up Ollama (Local AI)

If you are using local models for evaluation and vision (which is the default configuration), you need to pull the required models into your Ollama instance.

1. Start the Ollama server:
   ```bash
   ollama serve
   ```
2. Open a new terminal and pull the language model (for the evaluator) and the vision model (for frame analysis):
   ```bash
   ollama pull llama3.1
   ollama pull llava
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
   - `TRANSCRIPTION_PROVIDER`: Set to `local` (uses Python Whisper) or `assemblyai` (requires API key).
   - `EVALUATION_PROVIDER`: Set to `local` (uses Ollama) or `anthropic` (requires API key).
   - `OLLAMA_MODEL`: Set to `llama3.1` (or whichever text model you pulled).
   - `OLLAMA_VISION_MODEL`: Set to `llava` (or whichever vision model you pulled).

3. **Google Drive Integration (Optional):**
   If you want the system to watch a Google Drive folder:
   - Obtain a Google Service Account JSON key.
   - Save it as `google-credentials.json` in the project root.
   - Fill in `GOOGLE_DRIVE_FOLDER_URL` and `GOOGLE_SHEET_URL` in the `.env` file.

---

## ▶️ 4. Running the Pipeline

You can run the pipeline in two modes:

### Watch Mode (Continuous Polling)
The system will run continuously, checking the configured Google Drive folder (or local `data/watch` folder) every 30 seconds for new videos.
```bash
npm start
```
*(Or use `npm run dev` if you want automatic restarts during development).*

### Single Run Mode
If you want to process existing videos in the watch folder and then exit immediately without continuous polling:
```bash
npm run process
```

---

## 📂 5. Output Architecture

When a video is processed, the system creates the following artifacts in the `data/` directory:

- **`data/watch/`**: Drop video files here if not using Google Drive.
- **`data/working/<video_id>/`**: Temporary processing files (audio extraction, thumbnails).
- **`data/reports/`**: The final Markdown (`.md`) audit reports containing the factual accuracy audit, visual timeline, and overall academic rubric scores.

---

> **Tip:** The system features a smart, content-aware visual event detector. It dynamically changes its frame sampling rate based on what is on the screen (e.g. `WHITEBOARD` uses a 15-second debounce, while `SLIDES` uses a 5-second debounce with high change thresholds) to save LLM compute time!
