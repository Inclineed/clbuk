import argparse
import json
import sys
import os

def transcribe(audio_path, model_size):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Error: faster-whisper is not installed. Run scripts/setup-local-ai.ps1 first.", file=sys.stderr)
        sys.exit(1)

    # Use CPU with INT8 quantization for low resource usage on consumer machines
    # If a GPU is available, compute_type will be auto-selected or fallback to cpu
    device = "cpu"
    compute_type = "int8"
    
    # Check if GPU is available (optional optimization)
    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
    except ImportError:
        pass

    # Load model
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    # Transcribe
    segments, info = model.transcribe(audio_path, beam_size=5)

    result_segments = []
    for segment in segments:
        result_segments.append({
            "speaker": "Speaker 1", # Default to single speaker for local basic Whisper
            "startTime": round(segment.start, 2),
            "endTime": round(segment.end, 2),
            "text": segment.text.strip()
        })

    output = {
        "durationSeconds": round(info.duration, 2),
        "language": info.language,
        "segments": result_segments
    }

    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local Whisper Transcriber")
    parser.add_argument("--audio", required=True, help="Path to audio WAV file")
    parser.add_argument("--model", default="base", help="Whisper model size (tiny, base, small)")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    transcribe(args.audio, args.model)
