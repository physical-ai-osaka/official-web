import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

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
    try {
      japaneseSubtitles = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'ja',
      });
    } catch (error) {
      console.log('Japanese subtitles not available, skipping...');
    }

    return NextResponse.json({
      videoId,
      english: englishSubtitles,
      japanese: japaneseSubtitles,
    });
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
