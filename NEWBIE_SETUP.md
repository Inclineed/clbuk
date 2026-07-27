# 🔰 Beginners Guide: Step-by-Step Setup from Scratch

Welcome! If you have a brand-new computer or a machine that has absolutely nothing installed, this guide is for you. We will walk you through installing every tool required to run the **Classsbuk Transcript AI Reviewer** from scratch.

---

## 📋 Table of Contents
1. [Step 1: Install Git](#step-1-install-git)
2. [Step 2: Install Node.js](#step-2-install-node-js)
3. [Step 3: Choose Your AI Brain (Ollama or API Keys)](#step-3-choose-your-ai-brain-ollama-or-api-keys)
4. [Step 4: Clone & Download the Project](#step-4-clone--download-the-project)
5. [Step 5: Install Project Dependencies](#step-5-install-project-dependencies)
6. [Step 6: Configure Environment Settings](#step-6-configure-environment-settings)
7. [Step 7: Run the Application](#step-7-run-the-application)
8. [Step 8: Google Drive & Google Sheets Integration (Optional)](#step-8-google-drive--google-sheets-integration-optional)

---

## 🛠️ Step 1: Install Git
Git is a tool that allows you to download and manage code repositories.

### For Windows:
1. Download the installer from the official site: **[Git for Windows](https://git-scm.com/download/win)**.
2. Run the downloaded `.exe` file.
3. Click **Next** on all prompts (the default settings are perfect).
4. Open your command menu by pressing the **Windows Key**, typing `cmd`, and hitting **Enter**.
5. Type `git --version` and press Enter. If you see a version number (like `git version 2.x.x`), Git is successfully installed!

### For macOS:
1. Open the Terminal application (press `Cmd + Space`, type `Terminal`, and hit Enter).
2. Type `git --version` and hit Enter.
3. If not installed, a prompt will automatically appear asking if you want to install command-line developer tools. Click **Install** and follow the prompts.

---

## 🟢 Step 2: Install Node.js
Node.js is the engine that runs JavaScript code on your computer.

1. Go to the official website: **[Node.js Official Website](https://nodejs.org/)**.
2. Download the version labeled **LTS** (Long Term Support) — this is the most stable version.
3. Run the installer and click through the setup prompts (defaults are perfect).
4. Re-open your terminal (Command Prompt on Windows, Terminal on macOS).
5. Verify it is working by running these two commands:
   ```bash
   node -v
   npm -v
   ```
   If both commands output numbers (e.g., `v20.x.x` and `10.x.x`), you are ready!

---

## 🧠 Step 3: Choose Your AI Brain (Ollama or API Keys)
The reviewer needs an Artificial Intelligence model (LLM) to read and evaluate the class transcripts. You can choose to run this **100% free locally** on your computer, or connect to **cloud APIs** (like Claude or GPT-4).

### Option A: Local LLM (Free & Private)
This option runs the AI model directly on your own graphics card or processor.
1. Visit **[Ollama.com](https://ollama.com/)** and download the installer for your OS.
2. Install Ollama and launch the application.
3. Open your terminal/command prompt and run this command to download the AI brain (this requires ~4.7GB of internet download):
   ```bash
   ollama pull llama3.1
   ```
4. Keep the Ollama application running in the background.

### Option B: Cloud APIs (Fast & Highly Accurate)
If you prefer not to download large models locally, you can use paid API keys from top AI companies. The code is smart and will automatically use whichever key you configure:
- **Claude (Anthropic)**: Get a key at [Anthropic Console](https://console.anthropic.com/).
- **ChatGPT (OpenAI)**: Get a key at [OpenAI Platform](https://platform.openai.com/).
- **Gemini (Google)**: Get a key at [Google AI Studio](https://aistudio.google.com/).

---

## 📦 Step 4: Clone & Download the Project
Now we will fetch the project code onto your machine.

1. Open your terminal/command prompt.
2. Navigate to where you want to keep the project folder (e.g., your Documents folder):
   ```bash
   cd Documents
   ```
3. Clone the repository and navigate into the folder:
   ```bash
   git clone https://github.com/Inclineed/clbuk.git
   cd clbuk
   ```
4. Switch to the active branch for transcript analysis:
   ```bash
   git checkout feature/drive-transcript-analysis
   ```

---

## ⚙️ Step 5: Install Project Dependencies
Run the command below in the project directory to install all required libraries:
```bash
npm install
```
This might take a minute as it installs typescript, the Google API clients, and other tools.

---

## 📝 Step 6: Configure Environment Settings
We need to create a configuration file that tells the project where to look for files and which AI model to use.

1. Copy the example template to create your active `.env` file:
   - **On Windows Command Prompt**:
     ```cmd
     copy .env.example .env
     ```
   - **On macOS/Linux/Git Bash**:
     ```bash
     cp .env.example .env
     ```
2. Open the newly created `.env` file in a text editor (like Notepad, TextEdit, or VS Code).
3. Update the variables based on your setup:
   - If using cloud API keys, paste your key next to `ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`, or `GEMINI_API_KEY=`.
   - The system automatically detects keys and overrides the default provider in this order: **Claude > OpenAI > Gemini > Local Ollama**.

---

## ▶️ Step 7: Run the Application
You can now run the reviewer in two different modes:

### Mode A: Local Files (Immediate Testing)
1. In your project directory, navigate into `data/watch` (the folder will have been created for you).
2. Create or drop a text file named `2026-07-27_MrTeacher_Mathematics.txt` into that folder.
3. Open the file and paste some dialogue, for example:
   ```text
   [00:00] Mr. Smith: Hello everyone. Let's study algebra.
   [00:15] Student: Is it hard?
   [00:25] Mr. Smith: It is easy if you practice!
   ```
4. In your terminal, run the following command:
   ```bash
   npm run process
   ```
5. Look in the `data/reports/` folder. You will find a beautiful markdown audit report (`_report.md`) detailing the academic score, findings, and recommendations!

### Mode B: Watch Folder (Continuous Monitoring)
If you want the program to run in the background and scan for new files every 30 seconds:
```bash
npm start
```
To stop the program, press `Ctrl + C` in the terminal.

---

## ☁️ Step 8: Google Drive & Google Sheets Integration (Optional)
If you want to pull transcripts from a shared Google Drive folder and log evaluations directly to a shared Google Sheet:

1. **Get Service Account Credentials**:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a project, enable the **Google Drive API** and **Google Sheets API**.
   - Create a **Service Account** and generate a **JSON Key**.
   - Download the JSON key file, rename it to `google-credentials.json`, and place it in the root folder of this project.
2. **Share Folders/Sheets**:
   - Open your `google-credentials.json` file and copy the email address listed under `"client_email"`.
   - Go to your Google Drive folder and Google Sheet, click **Share**, and share them with that client email (give them **Editor** permissions).
3. **Configure Settings**:
   - Open your `.env` file and paste the link to your Google Drive folder under `GOOGLE_DRIVE_FOLDER_URL`.
   - Paste the link to your Google Sheet under `GOOGLE_SHEET_URL`.
