import { NextResponse } from 'next/server';
import { getProcessedVideos } from '@/lib/processed-videos';
import path from 'path';
import fs from 'fs/promises';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'subtitles');

async function hasValidCache(videoId: string): Promise<boolean> {
  try {
    const cachePath = path.join(CACHE_DIR, `${videoId}.json`);
    const cached = await fs.readFile(cachePath, 'utf-8');
    const cachedData = JSON.parse(cached);
    return cachedData.japanese && cachedData.japanese.length > 0;
  } catch (e) {
    return false;
  }
}

export async function GET() {
  try {
    const data = getProcessedVideos();

    // Filter videos: only include those with valid Japanese subtitle cache
    const videosWithCache = await Promise.all(
      data.videos.map(async (video) => {
        const hasCache = await hasValidCache(video.videoId);
        return hasCache ? video : null;
      })
    );

    const validVideos = videosWithCache.filter((v) => v !== null);

    // Return latest 20 videos with valid cache
    const latestVideos = validVideos.slice(0, 20);

    return NextResponse.json({
      videos: latestVideos,
      total: validVideos.length,
    });
  } catch (error) {
    console.error('Error fetching latest processed videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch latest processed videos' },
      { status: 500 }
    );
  }
}
