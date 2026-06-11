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

interface ChannelVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

export default function WatchPage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [videoId, setVideoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [englishTranscript, setEnglishTranscript] = useState<TranscriptLine[]>([]);
  const [japaneseTranscript, setJapaneseTranscript] = useState<TranscriptLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [supertfVideos, setSupertfVideos] = useState<ChannelVideo[]>([]);
  const [aspenVideos, setAspenVideos] = useState<ChannelVideo[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
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

    loadHistory();
    loadChannelVideos();
  }, []);

  const loadHistory = () => {
    try {
      const saved = localStorage.getItem('watchHistory');
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  const loadChannelVideos = async () => {
    setLoadingChannels(true);
    try {
      const supertfRes = await fetch('/api/channel-videos?channel=supertf');
      if (supertfRes.ok) {
        const data = await supertfRes.json();
        setSupertfVideos(data.videos || []);
      }

      const aspenRes = await fetch('/api/channel-videos?channel=aspen');
      if (aspenRes.ok) {
        const data = await aspenRes.json();
        setAspenVideos(data.videos || []);
      }
    } catch (error) {
      console.error('Failed to load channel videos:', error);
    } finally {
      setLoadingChannels(false);
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

  const saveToHistory = (vId: string, title?: string) => {
    try {
      const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
      const newEntry = {
        videoId: vId,
        videoTitle: title || `Video ${vId}`,
        timestamp: Date.now(),
      };

      const filtered = history.filter((h: any) => h.videoId !== vId);
      const updated = [newEntry, ...filtered].slice(0, 20);

      localStorage.setItem('watchHistory', JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  const loadVideo = async (url?: string) => {
    const urlToLoad = url || videoUrl;
    const vId = extractVideoId(urlToLoad);
    if (!vId) {
      alert('Invalid YouTube URL');
      return;
    }

    setVideoId(vId);
    setLoading(true);

    try {
      const res = await fetch('/api/dual-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: urlToLoad }),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch transcripts');
      }

      const data = await res.json();
      setEnglishTranscript(data.english || []);
      setJapaneseTranscript(data.japanese || []);

      saveToHistory(vId);
      loadHistory();
    } catch (error) {
      console.error('Error loading video:', error);
      alert('Failed to load transcripts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadVideoById = (vId: string) => {
    loadVideo(`https://www.youtube.com/watch?v=${vId}`);
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
              <h2 className="text-2xl font-semibold mb-4">動画を読み込む</h2>
              <p className="text-gray-600 mb-4">
                YouTube動画のURLを入力してください。英語字幕と日本語字幕を同時に表示します。
              </p>
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg mb-4"
              />
              <button
                onClick={() => loadVideo()}
                disabled={loading || !videoUrl}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? '読み込み中...' : '動画を読み込む'}
              </button>
            </div>

            {history.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-8">
                <h3 className="text-xl font-semibold mb-4 text-gray-700">最近見た動画</h3>
                <div className="space-y-2">
                  {history.slice(0, 10).map((entry) => (
                    <div
                      key={entry.videoId}
                      onClick={() => loadVideoById(entry.videoId)}
                      className="p-3 bg-gray-50 hover:bg-indigo-50 rounded-lg cursor-pointer transition-all border border-gray-200 hover:border-indigo-300"
                    >
                      <div className="flex gap-3 items-center">
                        <img
                          src={`https://img.youtube.com/vi/${entry.videoId}/default.jpg`}
                          alt={entry.videoTitle}
                          className="w-20 h-15 object-cover rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-800 truncate">
                            {entry.videoTitle}
                          </div>
                          <div className="text-sm text-gray-500">
                            {new Date(entry.timestamp).toLocaleString('ja-JP', {
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
              </div>
            )}

            {!loadingChannels && (supertfVideos.length > 0 || aspenVideos.length > 0) && (
              <div className="space-y-6">
                {supertfVideos.length > 0 && (
                  <div className="bg-white rounded-lg shadow-lg p-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">SuperTF - 最新動画</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {supertfVideos.slice(0, 6).map((video) => (
                        <div
                          key={video.videoId}
                          onClick={() => loadVideoById(video.videoId)}
                          className="p-3 bg-gray-50 hover:bg-indigo-50 rounded-lg cursor-pointer transition-all border border-gray-200 hover:border-indigo-300"
                        >
                          <img
                            src={video.thumbnail}
                            alt={video.title}
                            className="w-full h-32 object-cover rounded mb-2"
                          />
                          <div className="font-medium text-gray-800 text-sm line-clamp-2">
                            {video.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {new Date(video.publishedAt).toLocaleDateString('ja-JP')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aspenVideos.length > 0 && (
                  <div className="bg-white rounded-lg shadow-lg p-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">Aspen - 最新動画</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {aspenVideos.slice(0, 6).map((video) => (
                        <div
                          key={video.videoId}
                          onClick={() => loadVideoById(video.videoId)}
                          className="p-3 bg-gray-50 hover:bg-indigo-50 rounded-lg cursor-pointer transition-all border border-gray-200 hover:border-indigo-300"
                        >
                          <img
                            src={video.thumbnail}
                            alt={video.title}
                            className="w-full h-32 object-cover rounded mb-2"
                          />
                          <div className="font-medium text-gray-800 text-sm line-clamp-2">
                            {video.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {new Date(video.publishedAt).toLocaleDateString('ja-JP')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
                setVideoUrl('');
                setEnglishTranscript([]);
                setJapaneseTranscript([]);
              }}
              className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300"
            >
              ← 別の動画を読み込む
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
