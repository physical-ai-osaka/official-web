'use client';

import { useState, useRef, useEffect } from 'react';

interface TranscriptLine {
  text: string;
  offset: number;
  duration: number;
}

interface HistoryEntry {
  videoId: string;
  videoTitle: string;
  timestamp: number;
}

interface ProcessedVideo {
  videoId: string;
  title: string;
  channel: string;
  processedAt: string;
}

export default function WatchPage() {
  const [videoId, setVideoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [englishTranscript, setEnglishTranscript] = useState<TranscriptLine[]>([]);
  const [japaneseTranscript, setJapaneseTranscript] = useState<TranscriptLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [processedVideos, setProcessedVideos] = useState<ProcessedVideo[]>([]);
  const playerRef = useRef<any>(null);
  const [player, setPlayer] = useState<any>(null);

  useEffect(() => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    (window as any).onYouTubeIframeAPIReady = () => {
      console.log('YouTube IFrame API ready');
    };

    loadProcessedVideos();
  }, []);

  const loadProcessedVideos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/latest-videos');
      if (res.ok) {
        const data = await res.json();
        const videos = data.videos || [];

        // Filter videos: only show those with cached Japanese subtitles
        const videosWithCache = await Promise.all(
          videos.map(async (video: ProcessedVideo) => {
            try {
              const cacheRes = await fetch('/api/dual-subtitles/check-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId: video.videoId }),
              });

              if (cacheRes.ok) {
                const cacheData = await cacheRes.json();
                return cacheData.hasJapanese ? video : null;
              }
              return null;
            } catch (error) {
              console.error(`Cache check failed for ${video.videoId}:`, error);
              return null;
            }
          })
        );

        // Filter out null values
        const filteredVideos = videosWithCache.filter((v): v is ProcessedVideo => v !== null);
        setProcessedVideos(filteredVideos);
      }
    } catch (error) {
      console.error('Failed to load processed videos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (videoId && playerRef.current && typeof window !== 'undefined' && (window as any).YT) {
      const newPlayer = new (window as any).YT.Player(playerRef.current, {
        videoId,
        width: '100%',
        height: '480',
        playerVars: {
          autoplay: 0,
          controls: 1,
        },
        events: {
          onReady: () => {
            console.log('Player ready');
          },
        },
      });

      setPlayer(newPlayer);

      const interval = setInterval(() => {
        if (newPlayer && newPlayer.getCurrentTime) {
          const time = newPlayer.getCurrentTime();
          setCurrentTime(time);
        }
      }, 100);

      return () => {
        clearInterval(interval);
        newPlayer.destroy();
      };
    }
  }, [videoId]);

  const extractVideoId = (url: string): string | null => {
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
  };

  const loadVideoById = async (vId: string) => {
    setVideoId(vId);
    setLoading(true);

    try {
      const res = await fetch('/api/dual-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: `https://www.youtube.com/watch?v=${vId}` }),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch transcripts');
      }

      const data = await res.json();
      setEnglishTranscript(data.english || []);
      setJapaneseTranscript(data.japanese || []);
    } catch (error) {
      console.error('Error loading video:', error);
      alert('Failed to load transcripts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentLine = (transcript: TranscriptLine[]) => {
    return transcript.find(
      (line) =>
        currentTime >= line.offset / 1000 &&
        currentTime < (line.offset + line.duration) / 1000
    );
  };

  const currentEnglish = getCurrentLine(englishTranscript);
  const currentJapanese = getCurrentLine(japaneseTranscript);

  const scrollToTime = (offset: number) => {
    if (player && player.seekTo) {
      player.seekTo(offset / 1000, true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-4xl font-bold text-indigo-900">
            YouTube Watch & Learn 📺
          </h1>
          <a
            href="/"
            className="px-4 py-2 bg-white rounded-lg shadow hover:bg-gray-50 transition-all text-indigo-600 font-medium"
          >
            ← Mimic Quiz
          </a>
        </div>

        {!videoId ? (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-8">
              <h2 className="text-2xl font-semibold mb-4">処理済み動画一覧</h2>
              <p className="text-gray-600 mb-4">
                3時間ごとの自動処理で日本語字幕が生成された動画のみ表示されています。
              </p>

              {loading ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">読み込み中...</p>
                </div>
              ) : processedVideos.length > 0 ? (
                <div className="space-y-3">
                  {processedVideos.map((video) => (
                    <div
                      key={video.videoId}
                      onClick={() => loadVideoById(video.videoId)}
                      className="p-4 bg-gray-50 hover:bg-indigo-50 rounded-lg cursor-pointer transition-all border border-gray-200 hover:border-indigo-300"
                    >
                      <div className="flex gap-4 items-start">
                        <img
                          src={`https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`}
                          alt={video.title}
                          className="w-40 h-24 object-cover rounded flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-800 mb-1 line-clamp-2">
                            {video.title}
                          </div>
                          <div className="text-sm text-gray-500">
                            チャンネル: {video.channel}
                          </div>
                          <div className="text-sm text-gray-500">
                            処理日時: {new Date(video.processedAt).toLocaleString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500">処理済みの動画がまだありません。</p>
                  <p className="text-gray-400 text-sm mt-2">3時間ごとに自動で新しい動画が処理されます。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div ref={playerRef} className="w-full" style={{ aspectRatio: '16/9' }}></div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-bold mb-4 text-indigo-900">全字幕</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {englishTranscript.map((enLine, index) => {
                  const jpLine = japaneseTranscript[index];
                  const isActive =
                    currentTime >= enLine.offset / 1000 &&
                    currentTime < (enLine.offset + enLine.duration) / 1000;

                  return (
                    <div
                      key={index}
                      onClick={() => scrollToTime(enLine.offset)}
                      className={`p-3 rounded-lg cursor-pointer transition-all ${
                        isActive
                          ? 'bg-indigo-100 border-2 border-indigo-400'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <div className="text-sm text-gray-500 mb-1">
                        {Math.floor(enLine.offset / 1000 / 60)}:{String(Math.floor((enLine.offset / 1000) % 60)).padStart(2, '0')}
                      </div>
                      <div className="text-gray-800 font-medium">{enLine.text}</div>
                      {jpLine && (
                        <div className="text-gray-600 mt-1">{jpLine.text}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => {
                setVideoId('');
                setEnglishTranscript([]);
                setJapaneseTranscript([]);
              }}
              className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300"
            >
              ← 動画一覧に戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
