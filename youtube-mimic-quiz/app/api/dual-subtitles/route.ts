import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { pipeline } from '@xenova/transformers';
import path from 'path';
import fs from 'fs/promises';

// Lazy-load translation pipeline
let translatorPromise: Promise<any> | null = null;

async function getTranslator() {
  if (!translatorPromise) {
    console.log('[DUAL-SUBTITLES] Loading NLLB-200 translation model...');
    translatorPromise = pipeline('translation', 'Xenova/nllb-200-distilled-600M');
  }
  return translatorPromise;
}

interface TranscriptItem {
  text: string;
  offset: number;
  duration: number;
}

// Cache directory for subtitles
const CACHE_DIR = path.join(process.cwd(), '.cache', 'subtitles');

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (e) {
    // Ignore if already exists
  }
}

function getCachePath(videoId: string): string {
  return path.join(CACHE_DIR, `${videoId}.json`);
}

async function translateSubtitles(subtitles: TranscriptItem[]): Promise<TranscriptItem[]> {
  const translator = await getTranslator();
  console.log(`[DUAL-SUBTITLES] Translating ${subtitles.length} subtitle lines...`);

  const translated: TranscriptItem[] = [];

  for (let i = 0; i < subtitles.length; i++) {
    const item = subtitles[i];
    try {
      const result = await translator(item.text, {
        src_lang: 'eng_Latn',
        tgt_lang: 'jpn_Jpan'
      });

      // Sanitize translation result (remove offset numbers and pipe characters)
      let translatedText = result[0].translation_text;

      // Remove patterns like "1028799|>>" from start of text
      translatedText = translatedText.replace(/^\d+\|>>\s*/, '');

      translated.push({
        text: translatedText,
        offset: item.offset,
        duration: item.duration
      });

      if ((i + 1) % 10 === 0) {
        console.log(`[DUAL-SUBTITLES] Translated ${i + 1}/${subtitles.length} lines`);
      }
    } catch (error) {
      console.error(`[DUAL-SUBTITLES] Translation failed for line ${i}:`, error);
      // Fallback: keep original text
      translated.push(item);
    }
  }

  console.log(`[DUAL-SUBTITLES] Translation complete: ${translated.length} lines`);
  return translated;
}

export async function POST(req: NextRequest) {
  try {
    const { videoUrl, allowTranslation = false } = await req.json();

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'Video URL is required' },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    // Check cache first
    await ensureCacheDir();
    const cachePath = getCachePath(videoId);

    try {
      const cached = await fs.readFile(cachePath, 'utf-8');
      const cachedData = JSON.parse(cached);
      console.log(`[DUAL-SUBTITLES] Cache HIT for video ${videoId}`);
      return NextResponse.json(cachedData);
    } catch (e) {
      console.log(`[DUAL-SUBTITLES] Cache MISS for video ${videoId}, fetching...`);
    }

    // Fetch English subtitles (required)
    let englishSubtitles = null;
    try {
      englishSubtitles = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'en',
      });
    } catch (error) {
      console.error('Failed to fetch English subtitles:', error);
      return NextResponse.json(
        { error: 'No English subtitles available for this video' },
        { status: 404 }
      );
    }

    // Try to fetch Japanese subtitles (optional)
    let japaneseSubtitles = null;
    let translationInProgress = false;

    try {
      japaneseSubtitles = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'ja',
      });
      console.log('[DUAL-SUBTITLES] Japanese subtitles found on YouTube');
    } catch (error) {
      // Only allow translation if explicitly requested (from cron)
      if (!allowTranslation) {
        console.log('[DUAL-SUBTITLES] Japanese subtitles not available, translation not allowed');
        return NextResponse.json(
          { error: 'Japanese subtitles not available and translation not allowed' },
          { status: 404 }
        );
      }

      console.log('[DUAL-SUBTITLES] Japanese subtitles not available, will translate in background...');
      translationInProgress = true;

      // Start translation in background (non-blocking)
      translateSubtitles(englishSubtitles)
        .then(translated => {
          const result = {
            videoId,
            english: englishSubtitles,
            japanese: translated,
          };
          return fs.writeFile(cachePath, JSON.stringify(result, null, 2));
        })
        .then(() => {
          console.log(`[DUAL-SUBTITLES] Background translation completed and cached: ${videoId}`);
        })
        .catch(err => {
          console.error(`[DUAL-SUBTITLES] Background translation failed for ${videoId}:`, err);
        });
    }

    const result = {
      videoId,
      english: englishSubtitles,
      japanese: japaneseSubtitles,
      translationInProgress,
    };

    // Save to cache immediately (with english only if translation in progress)
    if (!translationInProgress) {
      try {
        await fs.writeFile(cachePath, JSON.stringify(result, null, 2));
        console.log(`[DUAL-SUBTITLES] Saved to cache: ${cachePath}`);
      } catch (e) {
        console.error('[DUAL-SUBTITLES] Failed to save cache:', e);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Dual subtitles fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subtitles' },
      { status: 500 }
    );
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
