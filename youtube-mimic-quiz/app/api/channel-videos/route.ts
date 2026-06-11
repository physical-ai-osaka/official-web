import { NextRequest, NextResponse } from 'next/server';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Channel IDs (you can find these from the channel URL or page source)
const CHANNELS = {
  supertf: 'UCQlcWZ70_bIIPUVUYwVCv0A', // SuperTF's channel ID (updated 2026-06-03)
  aspen: 'UCPrWwYRITOFC010fkXZ0Glw', // Aspen's channel ID
};

interface Video {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel');

  if (!channel || !(channel in CHANNELS)) {
    return NextResponse.json(
      { error: 'Invalid channel. Use "supertf" or "aspen"' },
      { status: 400 }
    );
  }

  if (!YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: 'YouTube API key not configured' },
      { status: 500 }
    );
  }

  try {
    const channelId = CHANNELS[channel as keyof typeof CHANNELS];

    // Get channel's uploads playlist
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
    );

    if (!channelRes.ok) {
      throw new Error('Failed to fetch channel info');
    }

    const channelData = await channelRes.json();
    const uploadsPlaylistId =
      channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      throw new Error('Could not find uploads playlist');
    }

    // Get videos from uploads playlist
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${YOUTUBE_API_KEY}`
    );

    if (!playlistRes.ok) {
      throw new Error('Failed to fetch videos');
    }

    const playlistData = await playlistRes.json();

    // Get video IDs to fetch durations
    const videoIds = playlistData.items
      .map((item: any) => item.snippet.resourceId.videoId)
      .join(',');

    // Fetch video details including duration
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${YOUTUBE_API_KEY}`
    );

    if (!videosRes.ok) {
      throw new Error('Failed to fetch video details');
    }

    const videosData = await videosRes.json();

    // Filter videos by duration (exclude videos longer than 1 hour)
    const videos: Video[] = videosData.items
      .filter((item: any) => {
        const duration = item.contentDetails.duration; // Format: PT1H2M3S
        // Parse ISO 8601 duration
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        const hours = parseInt(match?.[1] || '0', 10);

        // Exclude videos 1 hour or longer
        return hours < 1;
      })
      .map((item: any) => ({
        videoId: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        publishedAt: item.snippet.publishedAt,
      }));

    return NextResponse.json({ videos });
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch channel videos' },
      { status: 500 }
    );
  }
}
