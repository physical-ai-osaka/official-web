import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'subtitles');

function getCachePath(videoId: string): string {
  return path.join(CACHE_DIR, `${videoId}.json`);
}

export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const cachePath = getCachePath(videoId);

    try {
      const cached = await fs.readFile(cachePath, 'utf-8');
      const cachedData = JSON.parse(cached);

      // Check if Japanese subtitles exist (not just in progress)
      const hasCachedJapanese = cachedData.japanese && cachedData.japanese.length > 0;

      return NextResponse.json({
        cached: true,
        hasJapanese: hasCachedJapanese,
      });
    } catch (e) {
      return NextResponse.json({
        cached: false,
        hasJapanese: false,
      });
    }
  } catch (error) {
    console.error('Cache check error:', error);
    return NextResponse.json(
      { error: 'Failed to check cache' },
      { status: 500 }
    );
  }
}
