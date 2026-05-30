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

    // Fetch English transcript
    const englishTranscript = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: 'en',
    });

    // Try to fetch Japanese transcript
    let japaneseTranscript = null;
    try {
      japaneseTranscript = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'ja',
      });
    } catch (error) {
      console.log('Japanese transcript not available, will use translation fallback');
    }

    return NextResponse.json({
      english: englishTranscript,
      japanese: japaneseTranscript,
      videoId,
    });
  } catch (error) {
    console.error('Dual transcript fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcripts' },
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
