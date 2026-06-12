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

      return NextResponse.json({
        english: cachedData.english || [],
        japanese: cachedData.japanese || [],
        videoId,
      });
    } catch (e) {
      return NextResponse.json(
        { error: 'Cache not found for this video' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Cache read error:', error);
    return NextResponse.json(
      { error: 'Failed to read cache' },
      { status: 500 }
    );
  }
}
