import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { refineBatch, PhraseToRefine } from '../refine-timestamps/route';
import path from 'path';
import fs from 'fs/promises';
import { createJob, getJob } from '@/lib/job-queue';

// Fetch video title from YouTube
async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();
    const titleMatch = html.match(/<title>(.+?)<\/title>/);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].replace(' - YouTube', '').trim();
    }
  } catch (e) {
    console.error(`Failed to fetch video title for ${videoId}:`, e);
  }
  return `Video ${videoId.substring(0, 8)}...`;
}

// Debug: Check API key
const apiKey = process.env.GEMINI_API_KEY || '';
console.log('[SELECT-PHRASES] API Key exists:', !!apiKey);
console.log('[SELECT-PHRASES] API Key length:', apiKey.length);

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 8192, // Increased for longer responses (100 phrases needs ~6000-8000 tokens)
  },
});

interface TranscriptItem {
  text: string;
  offset: number;
  duration: number;
}

// Cache directory for processed videos
const CACHE_DIR = path.join(process.cwd(), '.cache', 'videos');

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (e) {
    // Ignore if already exists
  }
}

// Get cache file path for a video
function getCachePath(videoId: string): string {
  return path.join(CACHE_DIR, `${videoId}.json`);
}

export async function POST(req: NextRequest) {
  try {
    // Log API key status (first 10 chars only for security)
    const apiKeyStatus = process.env.GEMINI_API_KEY
      ? `Configured (${process.env.GEMINI_API_KEY.substring(0, 10)}...)`
      : 'NOT CONFIGURED';
    console.log(`[SELECT-PHRASES] Gemini API Key: ${apiKeyStatus}`);

    const { transcript, videoId, videoUrl, async: asyncMode } = await req.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Transcript is required' },
        { status: 400 }
      );
    }

    // Check cache first if videoId is provided
    if (videoId) {
      await ensureCacheDir();
      const cachePath = getCachePath(videoId);

      try {
        const cached = await fs.readFile(cachePath, 'utf-8');
        const cachedPhrases = JSON.parse(cached);
        console.log(`[SELECT-PHRASES] Cache HIT for video ${videoId}`);
        return NextResponse.json(
          { phrases: cachedPhrases, cached: true },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
            },
          }
        );
      } catch (e) {
        console.log(`[SELECT-PHRASES] Cache MISS for video ${videoId}, processing...`);

        // If async mode is requested, create a job and return immediately
        if (asyncMode && videoUrl) {
          const job = await createJob(videoId, videoUrl);
          console.log(`[SELECT-PHRASES] Created async job ${job.id} for video ${videoId}`);
          return NextResponse.json(
            {
              jobId: job.id,
              status: 'queued',
              message: 'Video queued for processing. This may take 2-4 minutes for first-time processing.'
            },
            {
              headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
              },
            }
          );
        }
      }
    }

    // Combine transcript into full text
    const fullText = transcript
      .map((item: TranscriptItem) => item.text)
      .join(' ');

    // Split transcript into chunks to avoid timeout with long videos
    const MAX_CHUNK_LENGTH = 5000; // characters per chunk
    const chunks: string[] = [];

    if (fullText.length > MAX_CHUNK_LENGTH) {
      // Split into chunks at sentence boundaries
      let currentChunk = '';
      const sentences = fullText.split(/([.!?]+\s+)/); // Keep delimiters

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > MAX_CHUNK_LENGTH && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }

      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
      }

      console.log(`[SELECT-PHRASES] Split ${fullText.length} chars into ${chunks.length} chunks`);
    } else {
      chunks.push(fullText);
    }

    // Process each chunk and collect phrases
    const allPhrasesData: { phrase: string; translation: string }[] = [];
    const phrasesPerChunk = Math.ceil(100 / chunks.length);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[SELECT-PHRASES] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars, requesting ${phrasesPerChunk} phrases)`);

      const prompt = `You are an English learning assistant. From the following transcript, select ${phrasesPerChunk} useful phrases or sentences for English pronunciation practice (mimicking).

Criteria:
1. Natural conversational expressions
2. Common phrases that learners can use in real life
3. Clear pronunciation patterns
4. Not too long (5-15 words per phrase)
5. Diverse grammar patterns
6. Variety of difficulty levels (beginner to advanced)

Transcript:
${chunk}

Return ONLY a JSON array of objects with "phrase" and "translation" (in Japanese), like:
[
  {"phrase": "Never gonna give you up", "translation": "絶対に君を諦めない"},
  {"phrase": "Never gonna let you down", "translation": "絶対に君を失望させない"}
]`;

      let text = '';
      let cleanedText = '';

      try {
        const startTime = Date.now();
        console.log(`[SELECT-PHRASES] Calling Gemini API for chunk ${i + 1}...`);

        // Add timeout to Gemini API call
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout (60s)')), 60000)
        );

        const result = await Promise.race([
          model.generateContent(prompt),
          timeoutPromise
        ]) as any;

        const elapsed = Date.now() - startTime;
        console.log(`[SELECT-PHRASES] Gemini API responded in ${elapsed}ms`);

        const response = result.response;
        text = response.text();

        // Extract JSON from response (Gemini sometimes adds markdown code blocks)
        cleanedText = text.trim();
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/```\n?/g, '');
        }

        // Parse Gemini's response
        const chunkPhrases = JSON.parse(cleanedText);
        allPhrasesData.push(...chunkPhrases);
        console.log(`[SELECT-PHRASES] Chunk ${i + 1} returned ${chunkPhrases.length} phrases`);
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error(`[SELECT-PHRASES] Failed to process chunk ${i + 1}:`, errorMsg);
        console.error(`[SELECT-PHRASES] Raw response (first 500 chars):`, text?.substring(0, 500));
        console.error(`[SELECT-PHRASES] Cleaned text (first 500 chars):`, cleanedText?.substring(0, 500));
        // Continue with other chunks even if one fails
      }
    }

    console.log(`[SELECT-PHRASES] Total phrases collected: ${allPhrasesData.length}`);
    const phrasesData = allPhrasesData.slice(0, 100); // Take top 100

    // Match phrases back to transcript timestamps with improved matching
    const selectedPhrases = phrasesData.map((item: { phrase: string; translation: string }) => {
      const matchResult = findBestMatchWithRange(item.phrase, transcript);
      return {
        phrase: item.phrase,
        translation: item.translation,
        timestamp: matchResult.start / 1000,
        duration: (matchResult.end - matchResult.start) / 1000,
      };
    });

    // Refine timestamps using Whisper if videoId is provided
    if (videoId) {
      try {
        console.log(`[SELECT-PHRASES] Calling refineBatch with ${selectedPhrases.length} phrases for video ${videoId}`);
        const startTime = Date.now();

        // Call refineBatch directly instead of using fetch
        const refinedPhrases = await refineBatch(videoId, selectedPhrases as PhraseToRefine[]);
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`[SELECT-PHRASES] refineBatch completed in ${elapsedTime}s, received ${refinedPhrases.length} phrases`);

        // Sort by confidence score (Whisper matching quality) and take top 50
        const sortedPhrases = refinedPhrases
          .filter((p: any) => p.audioUrl) // Only keep phrases with audio
          .sort((a: any, b: any) => {
            // Prioritize phrases with confidence scores
            const confA = a.confidence || 0;
            const confB = b.confidence || 0;
            return confB - confA; // Descending order
          })
          .slice(0, 50); // Take top 50

        console.log(`[SELECT-PHRASES] Selected ${sortedPhrases.length} out of ${refinedPhrases.length} phrases based on Whisper confidence`);

        // Fetch video title and add to all phrases
        const videoTitle = await fetchVideoTitle(videoId);
        const phrasesWithTitle = sortedPhrases.map((p: any) => ({
          ...p,
          videoTitle
        }));

        // Save to cache for future requests
        try {
          const cachePath = getCachePath(videoId);
          await fs.writeFile(cachePath, JSON.stringify(phrasesWithTitle, null, 2));
          console.log(`[SELECT-PHRASES] Saved results to cache: ${cachePath} (title: ${videoTitle})`);
        } catch (e) {
          console.error('[SELECT-PHRASES] Failed to save cache:', e);
        }

        console.log(`[SELECT-PHRASES] Returning response to client`);
        return NextResponse.json({ phrases: phrasesWithTitle, cached: false });
      } catch (error) {
        console.error('[SELECT-PHRASES] Whisper refinement failed, using fuzzy match timestamps:', error);
      }
    }

    // Fallback: Return phrases with placeholder audio (production mode)
    const fallbackPhrases = selectedPhrases.slice(0, 50).map((p: any) => ({
      ...p,
      audioUrl: '/api/audio/placeholder_unavailable.mp3',
      confidence: 0.5
    }));

    console.log(`[SELECT-PHRASES] Returning ${fallbackPhrases.length} phrases (Whisper refinement failed, using fallback)`);
    return NextResponse.json({ phrases: fallbackPhrases });
  } catch (error) {
    console.error('Phrase selection error:', error);
    return NextResponse.json(
      { error: 'Failed to select phrases' },
      { status: 500 }
    );
  }
}

function findBestMatchWithRange(
  phrase: string,
  transcript: TranscriptItem[]
): { start: number; end: number } {
  const phraseLower = phrase.toLowerCase().replace(/[^\w\s]/g, '');
  const phraseWords = phraseLower.split(/\s+/).filter(w => w.length > 0);

  let bestMatch = { start: 0, end: 3000, score: 0 };

  // Try to find the phrase across multiple transcript items
  for (let i = 0; i < transcript.length; i++) {
    for (let j = i; j < Math.min(i + 5, transcript.length); j++) {
      // Combine transcript items from i to j
      const combinedText = transcript
        .slice(i, j + 1)
        .map(item => item.text.toLowerCase().replace(/[^\w\s]/g, ''))
        .join(' ');

      const score = calculatePhraseScore(phraseWords, combinedText);

      if (score > bestMatch.score) {
        bestMatch = {
          start: transcript[i].offset,
          end: transcript[j].offset + transcript[j].duration,
          score,
        };
      }
    }
  }

  return { start: bestMatch.start, end: bestMatch.end };
}

function calculatePhraseScore(phraseWords: string[], transcriptText: string): number {
  const transcriptWords = transcriptText.split(/\s+/).filter(w => w.length > 0);

  // Calculate how many phrase words appear in the transcript text in order
  let matchCount = 0;
  let transcriptIndex = 0;

  for (const phraseWord of phraseWords) {
    let bestMatchScore = 0;
    let bestMatchIndex = -1;

    // Search for the best matching word in remaining transcript
    for (let i = transcriptIndex; i < transcriptWords.length; i++) {
      const tw = transcriptWords[i];
      let score = 0;

      // Exact match
      if (tw === phraseWord) {
        score = 1.0;
      }
      // One contains the other
      else if (tw.includes(phraseWord) || phraseWord.includes(tw)) {
        score = 0.8;
      }
      // Similar start (for plurals, verb forms, etc.)
      else if (phraseWord.length > 3 && tw.length > 3) {
        const commonPrefix = getCommonPrefixLength(phraseWord, tw);
        if (commonPrefix >= Math.min(phraseWord.length, tw.length) * 0.7) {
          score = 0.6;
        }
      }

      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestMatchIndex = i;
      }

      // Stop searching if we found a good match
      if (score >= 0.8) break;
    }

    if (bestMatchScore > 0.5) {
      matchCount += bestMatchScore;
      transcriptIndex = bestMatchIndex + 1;
    } else {
      transcriptIndex++;
    }
  }

  // Score based on matched words and length similarity
  const matchRatio = matchCount / phraseWords.length;
  const lengthRatio = Math.min(phraseWords.length, transcriptWords.length) /
                      Math.max(phraseWords.length, transcriptWords.length);

  return matchRatio * 0.8 + lengthRatio * 0.2;
}

function getCommonPrefixLength(str1: string, str2: string): number {
  let i = 0;
  while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
    i++;
  }
  return i;
}
