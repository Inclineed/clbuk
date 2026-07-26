# PowerShell setup script for Local AI dependencies
# Run this to set up Python virtual environment, faster-whisper, and Ollama model.

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Setting up Local AI Environment..." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Check Python
Write-Host ""
Write-Host "[1/4] Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Found Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Error "Python is not installed or not in system PATH. Please install Python 3.10 to 3.12."
}

# 2. Create Python virtual environment
Write-Host ""
Write-Host "[2/4] Setting up Python virtual environment (.venv-whisper)..." -ForegroundColor Yellow
$venvDir = Join-Path $PSScriptRoot "..\.venv-whisper"
if (!(Test-Path $venvDir)) {
    Write-Host "Creating virtual environment at $venvDir..." -ForegroundColor Gray
    python -m venv $venvDir
} else {
    Write-Host "Virtual environment already exists." -ForegroundColor Gray
}

$pipPath = Join-Path $venvDir "Scripts\pip.exe"
$pythonPath = Join-Path $venvDir "Scripts\python.exe"

# Upgrade pip & install faster-whisper
Write-Host "Upgrading pip..." -ForegroundColor Gray
& $pythonPath -m pip install --upgrade pip

Write-Host "Installing faster-whisper (this may take a minute)..." -ForegroundColor Gray
& $pipPath install faster-whisper

Write-Host "faster-whisper installed successfully." -ForegroundColor Green

# 3. Setup Ollama
Write-Host ""
Write-Host "[3/4] Checking Ollama status..." -ForegroundColor Yellow
$ollamaRunning = $false

# Check if port 11434 is active
$portCheck = Get-NetTCPConnection -LocalPort 11434 -ErrorAction SilentlyContinue
if ($portCheck) {
    Write-Host "Ollama server is already running." -ForegroundColor Green
    $ollamaRunning = $true
} else {
    Write-Host "Ollama server is not running. Starting Ollama app..." -ForegroundColor Gray
    try {
        # Try launching the app
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 5
        $portCheck = Get-NetTCPConnection -LocalPort 11434 -ErrorAction SilentlyContinue
        if ($portCheck) {
            Write-Host "Ollama server started successfully." -ForegroundColor Green
            $ollamaRunning = $true
        } else {
            Write-Warning "Could not start Ollama server automatically. Please launch the Ollama app manually on your desktop."
        }
    } catch {
        Write-Warning "Could not find Ollama installation. Please install Ollama from https://ollama.com."
    }
}

# 4. Pull Ollama Model
if ($ollamaRunning) {
    Write-Host ""
    Write-Host "[4/4] Pulling Ollama model 'llama3.2' (3B parameter model, ~2.0GB)..." -ForegroundColor Yellow
    Write-Host "This might take a few minutes if downloading for the first time..." -ForegroundColor Gray
    ollama pull llama3.2
    Write-Host "Model llama3.2 pulled successfully." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[4/4] Skipping model pull because Ollama server is not running." -ForegroundColor Yellow
    Write-Host "Please start Ollama and run: 'ollama pull llama3.2' manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Local AI Setup Completed Successfully!" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
