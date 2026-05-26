#!/usr/bin/env python3
"""
Batch processor for Whisper - processes multiple phrases in one go to reuse loaded models.
"""

import json
import sys
from whisper_processor import process_phrase

def main():
    if len(sys.argv) != 3:
        print("Usage: whisper_batch_processor.py <video_id> <phrases_json_file>", file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]
    phrases_file = sys.argv[2]

    # Read phrases from file
    with open(phrases_file, 'r') as f:
        phrases = json.load(f)

    # Process all phrases
    results = []
    for i, phrase_data in enumerate(phrases, 1):
        phrase = phrase_data['phrase']
        start = phrase_data['start']
        end = phrase_data['end']

        print(f"[{i}/{len(phrases)}] Processing: {phrase}", file=sys.stderr)

        result = process_phrase(video_id, phrase, start, end)
        results.append({
            'index': i - 1,
            'phrase': phrase,
            'result': result
        })

    # Output all results as JSON
    print(json.dumps(results))
    sys.stdout.flush()  # Ensure output is written immediately

if __name__ == "__main__":
    main()
