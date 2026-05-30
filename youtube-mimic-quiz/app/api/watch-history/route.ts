import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const HISTORY_FILE = path.join(process.cwd(), '.cache', 'watch-history.json');

interface HistoryItem {
  videoId: string;
  videoTitle: string;
  watchedAt: number;
}

async function ensureHistoryFile() {
  const dir = path.dirname(HISTORY_FILE);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }

  try {
    await fs.access(HISTORY_FILE);
  } catch {
    await fs.writeFile(HISTORY_FILE, JSON.stringify([]));
  }
}

export async function GET() {
  try {
    await ensureHistoryFile();
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    const history: HistoryItem[] = JSON.parse(data);

    // Return most recent first
    return NextResponse.json({
      history: history.sort((a, b) => b.watchedAt - a.watchedAt).slice(0, 20),
    });
  } catch (error) {
    console.error('Error reading history:', error);
    return NextResponse.json({ history: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { videoId, videoTitle } = await req.json();

    if (!videoId || !videoTitle) {
      return NextResponse.json(
        { error: 'videoId and videoTitle are required' },
        { status: 400 }
      );
    }

    await ensureHistoryFile();
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    let history: HistoryItem[] = JSON.parse(data);

    // Remove duplicate if exists
    history = history.filter((item) => item.videoId !== videoId);

    // Add new item at the beginning
    history.unshift({
      videoId,
      videoTitle,
      watchedAt: Date.now(),
    });

    // Keep only last 50 items
    history = history.slice(0, 50);

    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving history:', error);
    return NextResponse.json(
      { error: 'Failed to save history' },
      { status: 500 }
    );
  }
}
