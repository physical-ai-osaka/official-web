import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export interface PhraseToRefine {
  phrase: string;
  translation: string;
  timestamp: number;
  duration: number;
  audioUrl?: string;
  confidence?: number;
}

export async function POST(req: NextRequest) {
  try {
    const { videoId, phrases } = await req.json();

    if (!videoId || !phrases || !Array.isArray(phrases)) {
      return NextResponse.json(
        { error: 'videoId and phrases are required' },
        { status: 400 }
      );
    }

    // Use batch processor for better performance (reuses loaded models)
    const refinedPhrases = await refineBatch(videoId, phrases);

    return NextResponse.json({ phrases: refinedPhrases });
  } catch (error) {
    console.error('Timestamp refinement error:', error);
    return NextResponse.json(
      { error: 'Failed to refine timestamps' },
      { status: 500 }
    );
  }
}

export async function refineBatch(videoId: string, phrases: PhraseToRefine[]): Promise<PhraseToRefine[]> {
  return new Promise(async (resolve, reject) => {
    try {
      // Write phrases to temp file
      const tmpDir = os.tmpdir();
      const phrasesFile = path.join(tmpDir, `whisper_batch_${videoId}_${Date.now()}.json`);

      const phrasesData = phrases.map(p => ({
        phrase: p.phrase,
        start: p.timestamp,
        end: p.timestamp + p.duration
      }));

      await fs.writeFile(phrasesFile, JSON.stringify(phrasesData));

      // Run batch processor
      const scriptPath = path.join(process.cwd(), 'whisper_batch_processor.py');
      const childProcess = spawn('python3', [scriptPath, videoId, phrasesFile]);

      let output = '';
      let errorOutput = '';

      childProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        errorOutput += msg;
        // Forward progress messages
        if (msg.includes('[')) {
          console.log(msg.trim());
        }
      });

      childProcess.on('close', async (code) => {
        // Clean up temp file
        try {
          await fs.unlink(phrasesFile);
        } catch (e) {
          // Ignore cleanup errors
        }

        console.log(`[REFINE] Batch processor exited with code ${code}`);
        console.log(`[REFINE] Output length: ${output.length} bytes`);
        console.log(`[REFINE] Error output length: ${errorOutput.length} bytes`);

        if (errorOutput.length > 0) {
          // Show last 1000 chars of error output for debugging
          const errorPreview = errorOutput.slice(-1000);
          console.log(`[REFINE] Error output (last 1000 chars):\n${errorPreview}`);
        }

        if (code === 0 && output.trim()) {
          try {
            // Extract the last line (JSON output) - ignore warnings/logs
            const lines = output.trim().split('\n');
            const jsonLine = lines[lines.length - 1];
            const results = JSON.parse(jsonLine);

            console.log(`[REFINE] Parsed ${results.length} results from batch processor`);
            const successCount = results.filter((r: any) => r.result.success).length;
            const failedCount = results.length - successCount;
            console.log(`[REFINE] ${successCount} successful, ${failedCount} failed audio generations`);

            // Show a sample of failed results for debugging
            if (failedCount > 0) {
              const failedSample = results.filter((r: any) => !r.result.success).slice(0, 3);
              console.log(`[REFINE] Sample failed results:`, JSON.stringify(failedSample, null, 2));
            }

            // Ensure .cache/audio directory exists
            const audioDir = path.join(process.cwd(), '.cache', 'audio');
            await fs.mkdir(audioDir, { recursive: true });

            const refinedPhrases: PhraseToRefine[] = await Promise.all(phrases.map(async (phrase, idx) => {
              const result = results.find((r: any) => r.index === idx);

              if (result && result.result.success && result.result.audioPath) {
                const filename = result.result.audioPath.split('/').pop();
                const destPath = path.join(audioDir, filename);

                // Copy audio file from temp directory to .cache/audio
                try {
                  await fs.copyFile(result.result.audioPath, destPath);
                  console.log(`[REFINE] Copied audio file: ${filename}`);
                } catch (copyError) {
                  console.error(`[REFINE] Failed to copy ${filename}:`, copyError);
                }

                return {
                  phrase: phrase.phrase,
                  translation: phrase.translation,
                  timestamp: result.result.timestamp,
                  duration: result.result.duration,
                  audioUrl: `/api/audio/${filename}`,
                  confidence: result.result.confidence || 0,
                };
              }

              // Fallback to original
              return phrase;
            }));

            resolve(refinedPhrases);
          } catch (e) {
            console.error('Failed to parse batch output:', e);
            resolve(phrases);
          }
        } else {
          console.error(`Batch processor failed with code ${code}:`, errorOutput);
          resolve(phrases);
        }
      });

      // Set timeout for entire batch (15 minutes for 30 phrases)
      setTimeout(() => {
        childProcess.kill();
        console.error('Batch processor timeout after 15 minutes');
        resolve(phrases);
      }, 900000);
    } catch (e) {
      console.error('Batch processing error:', e);
      resolve(phrases);
    }
  });
}

async function refineTimestamp(
  videoId: string,
  phrase: PhraseToRefine,
  current: number,
  total: number
): Promise<PhraseToRefine> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'whisper_processor.py');

    const childProcess = spawn('python3', [
      scriptPath,
      videoId,
      phrase.phrase,
      phrase.timestamp.toString(),
      (phrase.timestamp + phrase.duration).toString(),
    ]);

    let output = '';
    let errorOutput = '';

    childProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    childProcess.on('close', (code) => {
      if (code === 0 && output.trim()) {
        try {
          const result = JSON.parse(output.trim());
          if (result.success && result.audioPath) {
            // Extract filename from full path
            const filename = result.audioPath.split('/').pop();

            // Audio file is already trimmed to exact phrase by Whisper processor
            resolve({
              phrase: phrase.phrase,
              translation: phrase.translation,
              timestamp: result.timestamp,
              duration: result.duration,
              audioUrl: `/api/audio/${filename}`,
              confidence: result.confidence || 0,
            });
          } else {
            console.error(`Whisper failed for phrase "${phrase.phrase}":`, result.error);
            // Fall back to original timestamps
            resolve(phrase);
          }
        } catch (e) {
          console.error('Failed to parse Whisper output:', e);
          resolve(phrase);
        }
      } else {
        console.error(`Whisper process failed with code ${code}:`, errorOutput);
        // Fall back to original timestamps
        resolve(phrase);
      }
    });

    // Set a timeout to prevent hanging
    setTimeout(() => {
      childProcess.kill();
      console.error(`Whisper timeout for phrase "${phrase.phrase}"`);
      resolve(phrase);
    }, 30000); // 30 second timeout per phrase
  });
}
