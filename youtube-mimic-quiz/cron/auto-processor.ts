import cron from 'node-cron';
import fetch from 'node-fetch';
import { getProcessedVideos, addProcessedVideo, needsReprocessing, getAppVersion } from '../lib/processed-videos';

const API_BASE = 'http://localhost:3000/api';
const SUPERTF_CHANNEL_ID = 'UC7ZUmtySp0bx2lw_1VGw3Yg';
const ASPEN_CHANNEL_ID = 'UCPrWwYRITOFC010fkXZ0Glw';

interface Video {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

const CURRENT_VERSION = getAppVersion();

// Get latest videos from a channel (up to 50)
async function getLatestVideos(channel: 'supertf' | 'aspen'): Promise<Video[]> {
  try {
    const response = await fetch(`${API_BASE}/channel-videos?channel=${channel}`);
    const data = await response.json();

    if (data.videos && data.videos.length > 0) {
      return data.videos;
    }

    return [];
  } catch (error) {
    console.error(`Failed to get latest videos for channel ${channel}:`, error);
    return [];
  }
}

// Process a video (generate phrases + audio + dual subtitles)
async function processVideo(video: Video, channel: 'supertf' | 'aspen'): Promise<boolean> {
  try {
    console.log(`Processing video: ${video.title} (${video.videoId})`);

    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

    // Step 1: Get dual subtitles (English + Japanese translation)
    console.log('  [1/4] Fetching dual subtitles...');
    const dualSubtitlesResponse = await fetch(`${API_BASE}/dual-subtitles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
    });

    if (!dualSubtitlesResponse.ok) {
      console.error('  Failed to fetch dual subtitles');
      return false;
    }

    const dualSubtitlesData = await dualSubtitlesResponse.json();
    console.log(`  ✓ Fetched ${dualSubtitlesData.english?.length || 0} English subtitles`);
    console.log(`  ✓ Generated ${dualSubtitlesData.japanese?.length || 0} Japanese subtitles`);

    // Step 2: Get transcript (still needed for phrase selection)
    console.log('  [2/4] Fetching transcript...');
    const transcriptResponse = await fetch(`${API_BASE}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
    });

    if (!transcriptResponse.ok) {
      console.error('  Failed to fetch transcript');
      return false;
    }

    const transcriptData = await transcriptResponse.json();

    // Step 3: Select phrases
    console.log('  [3/4] Selecting phrases...');
    const phrasesResponse = await fetch(`${API_BASE}/select-phrases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcriptData.transcript,
        videoId: video.videoId,
      }),
    });

    if (!phrasesResponse.ok) {
      console.error('  Failed to select phrases');
      return false;
    }

    const phrasesData = await phrasesResponse.json();
    console.log(`  ✓ Selected ${phrasesData.phrases?.length || 0} phrases`);

    // Step 4: Generate audio playlist
    console.log('  [4/4] Generating audio playlist...');
    const concatResponse = await fetch(`${API_BASE}/concat-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: video.videoId,
        phrases: phrasesData.phrases,
      }),
    });

    if (!concatResponse.ok) {
      console.error('  Failed to generate audio playlist');
      return false;
    }

    const concatData = await concatResponse.json();
    console.log(`  ✓ Audio playlist generated: ${concatData.audioUrl}`);

    // Record processing history
    addProcessedVideo({
      videoId: video.videoId,
      title: video.title,
      channel,
      processedAt: new Date().toISOString(),
      appVersion: CURRENT_VERSION,
    });

    console.log(`  ✓ Successfully processed: ${video.title}`);
    return true;
  } catch (error) {
    console.error(`Failed to process video ${video.videoId}:`, error);
    return false;
  }
}

// Main auto-processing function
async function autoProcess() {
  console.log('=== Auto-processing started ===');
  console.log(`Time: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`App Version: ${CURRENT_VERSION}`);

  try {
    // Check SuperTF channel
    console.log('\nChecking SuperTF channel (latest 50 videos)...');
    const supertfVideos = await getLatestVideos('supertf');

    let processedCount = 0;
    for (const video of supertfVideos) {
      if (needsReprocessing(video.videoId, CURRENT_VERSION)) {
        console.log(`Video needs processing: ${video.title}`);
        const success = await processVideo(video, 'supertf');
        if (success) {
          processedCount++;
          break; // Process only 1 video per hour
        }
      }
    }

    if (processedCount === 0) {
      console.log('All SuperTF videos are up to date');
    }

    // Check Aspen channel
    console.log('\nChecking Aspen channel (latest 50 videos)...');
    const aspenVideos = await getLatestVideos('aspen');

    processedCount = 0;
    for (const video of aspenVideos) {
      if (needsReprocessing(video.videoId, CURRENT_VERSION)) {
        console.log(`Video needs processing: ${video.title}`);
        const success = await processVideo(video, 'aspen');
        if (success) {
          processedCount++;
          break; // Process only 1 video per hour
        }
      }
    }

    if (processedCount === 0) {
      console.log('All Aspen videos are up to date');
    }

    console.log('\n=== Auto-processing completed ===\n');
  } catch (error) {
    console.error('Auto-processing error:', error);
  }
}

// Schedule: Run every 3 hours at :00 minutes
cron.schedule('0 */3 * * *', () => {
  autoProcess();
}, {
  timezone: 'Asia/Tokyo'
});

console.log('Auto-processor started!');
console.log('Schedule: Every 3 hours at :00 minutes (Asia/Tokyo timezone)');
console.log('Monitoring channels: SuperTF, Aspen');
console.log('Press Ctrl+C to stop\n');

// Run once immediately on startup
autoProcess();
