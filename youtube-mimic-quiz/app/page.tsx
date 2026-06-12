'use client';

import { useState, useRef, useEffect } from 'react';

interface Phrase {
  phrase: string;
  translation: string;
  timestamp: number;
  duration: number;
  audioUrl?: string;
}

interface SavedQuiz {
  videoId: string;
  videoTitle: string;
  phrases: Phrase[];
  savedAt: number;
}

export default function Home() {
  const [videoId, setVideoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [userTranscript, setUserTranscript] = useState('');
  const [feedback, setFeedback] = useState('');
  const [savedQuizzes, setSavedQuizzes] = useState<SavedQuiz[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [playlistAudioUrl, setPlaylistAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoPlayStopRef = useRef(false);
  const wakeLockRef = useRef<any>(null);
  const playlistAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // Load cached videos from server
    loadCachedVideos();

    // Load favorites from localStorage
    loadFavorites();
  }, []);

  const loadFavorites = () => {
    try {
      const saved = localStorage.getItem('mimicFavorites');
      if (saved) {
        setFavorites(new Set(JSON.parse(saved)));
      }
    } catch (error) {
      console.error('Error loading favorites:', error);
    }
  };

  const toggleFavorite = (phraseText: string) => {
    const newFavorites = new Set(favorites);

    // In favorites mode, find and remove the favorite
    if (videoId === 'favorites') {
      // Find the matching favorite key (videoId:phraseText)
      const matchingKey = Array.from(favorites).find(fav => fav.endsWith(`:${phraseText}`));
      if (matchingKey) {
        newFavorites.delete(matchingKey);
      }
    } else {
      const favoriteKey = `${videoId}:${phraseText}`;
      if (newFavorites.has(favoriteKey)) {
        newFavorites.delete(favoriteKey);
      } else {
        newFavorites.add(favoriteKey);
      }
    }

    setFavorites(newFavorites);
    localStorage.setItem('mimicFavorites', JSON.stringify(Array.from(newFavorites)));
  };

  const isFavorite = (phraseText: string): boolean => {
    // In favorites mode, all phrases are favorites
    if (videoId === 'favorites') return true;
    return favorites.has(`${videoId}:${phraseText}`);
  };

  const getAllFavoritePhrases = async (): Promise<Phrase[]> => {
    const allPhrases: Phrase[] = [];

    // Group favorites by videoId
    const grouped: { [videoId: string]: string[] } = {};
    favorites.forEach(fav => {
      const [vId, phraseText] = fav.split(':');
      if (!grouped[vId]) grouped[vId] = [];
      grouped[vId].push(phraseText);
    });

    // Fetch phrases for each video and filter favorites
    for (const vId of Object.keys(grouped)) {
      try {
        const res = await fetch('/api/select-phrases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: [],
            videoId: vId,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.phrases) {
            // Filter only favorite phrases
            const favPhrases = data.phrases.filter((p: Phrase) =>
              grouped[vId].includes(p.phrase)
            );
            allPhrases.push(...favPhrases);
          }
        }
      } catch (error) {
        console.error(`Error loading phrases for ${vId}:`, error);
      }
    }

    return allPhrases;
  };

  const loadCachedVideos = async () => {
    try {
      const res = await fetch('/api/latest-videos');
      console.log('Loading cached videos, response ok:', res.ok);
      if (res.ok) {
        const data = await res.json();
        console.log('Loaded videos data:', data);
        const videos = data.videos || [];

        // Filter videos: only show those with cached Japanese subtitles
        const videosWithCache = await Promise.all(
          videos.map(async (v: any) => {
            try {
              const cacheRes = await fetch('/api/dual-subtitles/check-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId: v.videoId }),
              });

              if (cacheRes.ok) {
                const cacheData = await cacheRes.json();
                return cacheData.hasJapanese ? v : null;
              }
              return null;
            } catch (error) {
              console.error(`Cache check failed for ${v.videoId}:`, error);
              return null;
            }
          })
        );

        // Filter out null values and map to SavedQuiz
        const filteredVideos = videosWithCache.filter((v): v is any => v !== null);
        const quizzes: SavedQuiz[] = filteredVideos.map((v: any) => ({
          videoId: v.videoId,
          videoTitle: v.title,
          phrases: [], // Phrases will be loaded on demand
          savedAt: new Date(v.processedAt).getTime(),
        }));
        console.log('Setting savedQuizzes:', quizzes.length, 'videos');
        setSavedQuizzes(quizzes);
      }
    } catch (error) {
      console.error('Error loading cached videos:', error);
    }
  };

  const generatePlaylistAudio = async (videoId: string, phrases: Phrase[]) => {
    try {
      console.log(`Generating playlist audio for ${videoId}...`);
      const res = await fetch('/api/concat-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, phrases }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.audioUrl) {
          setPlaylistAudioUrl(data.audioUrl);
          console.log(`Playlist audio ready: ${data.audioUrl} (cached: ${data.cached})`);
        }
      } else {
        console.error('Failed to generate playlist audio:', await res.text());
      }
    } catch (error) {
      console.error('Error generating playlist audio:', error);
    }
  };

  const loadSavedQuiz = async (quiz: SavedQuiz) => {
    try {
      setLoading(true);

      // Fetch phrases from cache
      const res = await fetch('/api/select-phrases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: [], // Empty transcript, just checking cache
          videoId: quiz.videoId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.phrases) {
          setVideoId(quiz.videoId);
          setPhrases(data.phrases);
          setCurrentIndex(0);
          setUserTranscript('');
          setFeedback('');
          setShowAllFavorites(false);
          setShowOnlyFavorites(false);

          // Generate concatenated audio playlist in background
          generatePlaylistAudio(quiz.videoId, data.phrases);
        }
      } else {
        throw new Error('Failed to load cached video');
      }
    } catch (error) {
      console.error('Error loading saved quiz:', error);
      alert('Failed to load video. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadAllFavorites = async () => {
    try {
      setLoading(true);

      const favPhrases = await getAllFavoritePhrases();

      if (favPhrases.length > 0) {
        setVideoId('favorites'); // Special ID for favorites mode
        setPhrases(favPhrases);
        setCurrentIndex(0);
        setUserTranscript('');
        setFeedback('');
        setShowAllFavorites(true);
        setShowOnlyFavorites(false);
      } else {
        alert('お気に入りのフレーズがありません');
      }
    } catch (error) {
      console.error('Error loading favorites:', error);
      alert('Failed to load favorites. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-play audio when navigating to a new phrase
  useEffect(() => {
    if (phrases.length > 0 && audioRef.current) {
      const currentPhrase = phrases[currentIndex];
      if (currentPhrase.audioUrl) {
        audioRef.current.src = currentPhrase.audioUrl;
      }
      playAudio();
    }
  }, [currentIndex, phrases]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phrases.length === 0) return;

      if (e.key === 'ArrowLeft') {
        prevPhrase();
      } else if (e.key === 'ArrowRight') {
        nextPhrase();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phrases, currentIndex]);

  const playAudio = () => {
    if (!phrases[currentIndex] || !audioRef.current) return;

    const currentPhrase = phrases[currentIndex];

    if (currentPhrase.audioUrl) {
      const audio = audioRef.current;
      audio.src = currentPhrase.audioUrl;

      // Audio file is already trimmed to exact phrase, just play it
      audio.onloadedmetadata = () => {
        audio.play().catch((error) => {
          console.error('Audio playback failed:', error);
          alert('Failed to play audio. Please try again.');
        });
      };
    } else {
      // No audio available (production mode without Whisper)
      alert('Audio playback is not available in this version. Please practice by reading the text!');
    }
  };

  const startRecording = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const SpeechRecognition =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    const recognitionInstance = new SpeechRecognition();
    recognitionInstance.lang = 'en-US';
    recognitionInstance.interimResults = false;

    recognitionInstance.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setUserTranscript(transcript);
      checkPronunciation(transcript);
    };

    recognitionInstance.onend = () => {
      setIsRecording(false);
    };

    recognitionInstance.start();
    setIsRecording(true);
    setRecognition(recognitionInstance);
  };

  const stopRecording = () => {
    if (recognition) {
      recognition.stop();
    }
  };

  const checkPronunciation = (transcript: string) => {
    const original = phrases[currentIndex].phrase.toLowerCase();
    const spoken = transcript.toLowerCase();

    // Simple similarity check (can be improved)
    const similarity = calculateSimilarity(original, spoken);

    if (similarity > 0.7) {
      setFeedback('✅ Great! Almost perfect!');
    } else if (similarity > 0.5) {
      setFeedback('👍 Good try! Practice more.');
    } else {
      setFeedback('🔄 Try again!');
    }
  };

  const calculateSimilarity = (str1: string, str2: string): number => {
    const words1 = str1.split(' ');
    const words2 = str2.split(' ');
    const matches = words1.filter((word) => words2.includes(word)).length;
    return matches / Math.max(words1.length, words2.length);
  };

  const getFilteredPhrases = () => {
    if (!showOnlyFavorites) return phrases;
    return phrases.filter(p => isFavorite(p.phrase));
  };

  const nextPhrase = () => {
    const filtered = getFilteredPhrases();
    const currentInFiltered = filtered.findIndex(p => p.phrase === phrases[currentIndex].phrase);

    if (currentInFiltered < filtered.length - 1) {
      const nextPhrase = filtered[currentInFiltered + 1];
      const nextIndex = phrases.findIndex(p => p.phrase === nextPhrase.phrase);
      setCurrentIndex(nextIndex);
      setUserTranscript('');
      setFeedback('');
    }
  };

  const prevPhrase = () => {
    const filtered = getFilteredPhrases();
    const currentInFiltered = filtered.findIndex(p => p.phrase === phrases[currentIndex].phrase);

    if (currentInFiltered > 0) {
      const prevPhrase = filtered[currentInFiltered - 1];
      const prevIndex = phrases.findIndex(p => p.phrase === prevPhrase.phrase);
      setCurrentIndex(prevIndex);
      setUserTranscript('');
      setFeedback('');
    }
  };

  const formatTimestamp = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const playAudioOnce = (audioUrl: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!audioRef.current) {
        resolve();
        return;
      }

      const audio = audioRef.current;

      const handleEnded = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        resolve();
      };

      const handleLoadedData = () => {
        audio.removeEventListener('loadeddata', handleLoadedData);
        audio.play().catch(() => {
          cleanup();
          resolve();
        });
      };

      const cleanup = () => {
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
        audio.removeEventListener('loadeddata', handleLoadedData);
      };

      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);
      audio.addEventListener('loadeddata', handleLoadedData);

      audio.src = audioUrl;
      audio.load();
    });
  };

  const speakText = (text: string, lang: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  };

  const autoPlayPhrase = async (index: number) => {
    const phrase = phrases[index];

    console.log('autoPlayPhrase:', { index, hasAudioUrl: !!phrase.audioUrl, audioUrl: phrase.audioUrl });

    if (!phrase.audioUrl || !audioRef.current) {
      // No audio available, skip
      console.log('Skipping - no audio or audioRef');
      return;
    }

    const audio = audioRef.current;

    // 1. 原文英語（YouTube録音）
    await playAudioOnce(phrase.audioUrl);
    await new Promise(resolve => setTimeout(resolve, 500));

    // 2. 原文英語（YouTube録音）- 同じ
    await playAudioOnce(phrase.audioUrl);
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. 機械音声英語（TTS）
    await speakText(phrase.phrase, 'en-US');
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. 機械音声日本語（TTS）
    await speakText(phrase.translation, 'ja-JP');
    await new Promise(resolve => setTimeout(resolve, 500));

    // 5. 原文英語（YouTube録音）
    await playAudioOnce(phrase.audioUrl);
    await new Promise(resolve => setTimeout(resolve, 800));
  };

  const startAutoPlay = async () => {
    // Use concatenated audio if available
    if (playlistAudioUrl && playlistAudioRef.current) {
      setIsAutoPlaying(true);
      autoPlayStopRef.current = false;

      // Request Wake Lock to prevent sleep
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock activated - screen will stay on');
        }
      } catch (err) {
        console.log('Wake Lock not supported or denied:', err);
      }

      // Setup Media Session API for background playback
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'YouTube Mimic Quiz - Playlist',
          artist: 'English Learning',
          album: videoId || 'Practice Session',
        });

        navigator.mediaSession.setActionHandler('play', () => {
          if (playlistAudioRef.current) {
            playlistAudioRef.current.play();
          }
        });

        navigator.mediaSession.setActionHandler('pause', () => {
          if (playlistAudioRef.current) {
            playlistAudioRef.current.pause();
          }
        });

        navigator.mediaSession.setActionHandler('stop', () => {
          stopAutoPlay();
        });
      }

      const audio = playlistAudioRef.current;
      audio.src = playlistAudioUrl;

      audio.onended = () => {
        setIsAutoPlaying(false);
      };

      audio.onerror = () => {
        console.error('Playlist audio playback error');
        setIsAutoPlaying(false);
      };

      try {
        await audio.play();
      } catch (error) {
        console.error('Failed to play playlist audio:', error);
        setIsAutoPlaying(false);
      }
    } else {
      // Fallback to old phrase-by-phrase playback
      setIsAutoPlaying(true);
      autoPlayStopRef.current = false;

      // Request Wake Lock to prevent sleep
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock activated - screen will stay on');
        }
      } catch (err) {
        console.log('Wake Lock not supported or denied:', err);
      }

      // Setup Media Session API for background playback
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'YouTube Mimic Quiz - Auto Play',
          artist: 'English Learning',
          album: videoId || 'Practice Session',
        });

        navigator.mediaSession.setActionHandler('play', () => {
          if (audioRef.current) {
            audioRef.current.play();
          }
        });

        navigator.mediaSession.setActionHandler('pause', () => {
          stopAutoPlay();
        });

        navigator.mediaSession.setActionHandler('stop', () => {
          stopAutoPlay();
        });
      }

      for (let i = currentIndex; i < phrases.length; i++) {
        if (autoPlayStopRef.current) {
          break;
        }

        setCurrentIndex(i);

        // Update Media Session with current phrase
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: phrases[i].phrase,
            artist: phrases[i].translation,
            album: `Phrase ${i + 1} / ${phrases.length}`,
          });
        }

        await autoPlayPhrase(i);
      }

      setIsAutoPlaying(false);
    }
  };

  const stopAutoPlay = () => {
    autoPlayStopRef.current = true;
    setIsAutoPlaying(false);

    // Stop playlist audio if playing
    if (playlistAudioRef.current) {
      playlistAudioRef.current.pause();
      playlistAudioRef.current.currentTime = 0;
    }

    // Stop phrase audio if playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    // Release Wake Lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      console.log('Wake Lock released');
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-indigo-900">
            YouTube Mimic Quiz 🎤
          </h1>
          <a
            href="/watch"
            className="px-4 py-2 bg-white rounded-lg shadow hover:bg-gray-50 transition-all text-indigo-600 font-medium"
          >
            📺 Watch & Learn →
          </a>
        </div>

        {phrases.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-semibold mb-4">処理済み動画から練習を始めよう</h2>
            <p className="text-gray-600 mb-4">
              3時間ごとに自動処理された動画から、発音練習用のフレーズを選んで練習できます。
            </p>

            {savedQuizzes.length > 0 ? (
              <div>
                <button
                  onClick={loadAllFavorites}
                  disabled={loading}
                  className="mb-6 px-4 py-2 bg-yellow-100 border-2 border-yellow-400 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  ⭐ お気に入り一覧を見る
                </button>
                <h3 className="text-xl font-semibold mb-4 text-gray-700">
                  練習できる動画一覧
                </h3>
                <div className="space-y-3">
                  {savedQuizzes.map((quiz) => (
                    <div key={quiz.videoId} className="border border-gray-300 rounded-lg overflow-hidden hover:border-indigo-400 transition-all">
                      <div className="flex gap-4 p-3">
                        <a
                          href={`https://www.youtube.com/watch?v=${quiz.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <img
                            src={`https://img.youtube.com/vi/${quiz.videoId}/mqdefault.jpg`}
                            alt={quiz.videoTitle}
                            className="w-32 h-20 object-cover rounded hover:opacity-80 transition-opacity"
                          />
                        </a>
                        <button
                          onClick={() => loadSavedQuiz(quiz)}
                          disabled={loading}
                          className="flex-1 text-left min-w-0"
                        >
                          <div className="font-medium text-gray-800 truncate hover:text-indigo-600">
                            {quiz.videoTitle}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {new Date(quiz.savedAt).toLocaleString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                          <a
                            href={`https://www.youtube.com/watch?v=${quiz.videoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-500 hover:underline mt-1 inline-block"
                            onClick={(e) => e.stopPropagation()}
                          >
                            YouTubeで見る →
                          </a>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500">処理済みの動画がまだありません。</p>
                <p className="text-gray-400 text-sm mt-2">3時間ごとに自動で新しい動画が処理されます。</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    showOnlyFavorites
                      ? 'bg-yellow-100 text-yellow-800 border-2 border-yellow-400'
                      : 'bg-gray-100 text-gray-700 border-2 border-gray-300'
                  }`}
                >
                  {showOnlyFavorites ? '⭐ お気に入りのみ' : '☆ すべて表示'}
                </button>
                <span className="text-sm text-gray-500">
                  {showOnlyFavorites
                    ? `お気に入り: ${phrases.filter(p => isFavorite(p.phrase)).length}個`
                    : `全${phrases.length}個`}
                </span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-500">
                  Phrase {currentIndex + 1} of {phrases.length}
                </span>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => toggleFavorite(phrases[currentIndex].phrase)}
                    className="text-2xl hover:scale-110 transition-transform"
                    title={isFavorite(phrases[currentIndex].phrase) ? 'お気に入りから削除' : 'お気に入りに追加'}
                  >
                    {isFavorite(phrases[currentIndex].phrase) ? '⭐' : '☆'}
                  </button>
                  <button
                    onClick={() => {
                      setPhrases([]);
                      setVideoId('');
                      setShowOnlyFavorites(false);
                      setShowAllFavorites(false);
                    }}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    ← ホームに戻る
                  </button>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${((currentIndex + 1) / phrases.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="text-center mb-8">
              <div className="text-3xl font-bold text-gray-800 mb-4 p-6 bg-indigo-50 rounded-lg">
                {phrases[currentIndex].phrase}
              </div>

              <div className="text-xl text-gray-600 mb-4 p-4 bg-yellow-50 rounded-lg">
                {phrases[currentIndex].translation}
              </div>

              <div className="text-sm text-gray-500 mb-4">
                [{formatTimestamp(phrases[currentIndex].timestamp)} - {formatTimestamp(phrases[currentIndex].timestamp + phrases[currentIndex].duration)}]
              </div>

              {/* Audio Player */}
              {phrases[currentIndex].audioUrl && (
                <div className="mb-6">
                  <audio
                    ref={audioRef}
                    controls
                    className="w-full max-w-md mx-auto rounded-lg shadow-md"
                    style={{ height: '54px' }}
                  />
                </div>
              )}

              <div className="flex gap-4 justify-center mb-4">
                <button
                  onClick={playAudio}
                  className="bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-600"
                >
                  🎵 Play Audio
                </button>
                <button
                  onClick={isAutoPlaying ? stopAutoPlay : startAutoPlay}
                  className={`px-6 py-3 rounded-lg font-semibold text-white ${
                    isAutoPlaying
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-purple-500 hover:bg-purple-600'
                  }`}
                >
                  {isAutoPlaying ? '⏹️ 自動再生停止' : '🔊 自動再生モード（スリープ防止）'}
                </button>
              </div>
            </div>

            <div className="text-center mb-6">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isAutoPlaying}
                className={`px-8 py-4 rounded-lg font-semibold text-white ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-green-500 hover:bg-green-600'
                } disabled:bg-gray-400 disabled:cursor-not-allowed`}
              >
                {isRecording ? '⏹️ Stop Recording' : '🎤 Start Recording'}
              </button>
            </div>

            {userTranscript && (
              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-1">You said:</p>
                <p className="text-lg text-gray-800 font-medium">
                  {userTranscript}
                </p>
              </div>
            )}

            {feedback && (
              <div className="mb-6 text-center">
                <p className="text-xl font-semibold text-indigo-700">
                  {feedback}
                </p>
              </div>
            )}

            <div className="flex justify-between">
              <button
                onClick={prevPhrase}
                disabled={currentIndex === 0}
                className="px-6 py-2 bg-gray-300 rounded-lg font-semibold hover:bg-gray-400 disabled:bg-gray-200 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button
                onClick={nextPhrase}
                disabled={currentIndex === phrases.length - 1}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden audio elements for playback */}
      <audio ref={audioRef} style={{ display: 'none' }} />
      <audio ref={playlistAudioRef} style={{ display: 'none' }} />
    </div>
  );
}
