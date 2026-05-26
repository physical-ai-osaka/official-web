import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { refineBatch, PhraseToRefine } from '../refine-timestamps/route';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

interface TranscriptItem {
  text: string;
  offset: number;
  duration: number;
}

export async function POST(req: NextRequest) {
  try {
    const { transcript, videoId } = await req.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Transcript is required' },
        { status: 400 }
      );
    }

    // Combine transcript into full text
    const fullText = transcript
      .map((item: TranscriptItem) => item.text)
      .join(' ');

    // Use Gemini to select useful phrases (generate 30 candidates)
    const prompt = `You are an English learning assistant. From the following transcript, select 30 useful phrases or sentences for English pronunciation practice (mimicking).

Criteria:
1. Natural conversational expressions
2. Common phrases that learners can use in real life
3. Clear pronunciation patterns
4. Not too long (5-15 words per phrase)
5. Diverse grammar patterns

Transcript:
${fullText}

Return ONLY a JSON array of objects with "phrase" and "translation" (in Japanese), like:
[
  {"phrase": "Never gonna give you up", "translation": "絶対に君を諦めない"},
  {"phrase": "Never gonna let you down", "translation": "絶対に君を失望させない"}
]`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Extract JSON from response (Gemini sometimes adds markdown code blocks)
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/```\n?/g, '');
    }

    // Parse Gemini's response
    const phrasesData = JSON.parse(cleanedText);

    // Match phrases back to transcript timestamps with improved matching
    const selectedPhrases = phrasesData.map((item: { phrase: string; translation: string }) => {
      const matchResult = findBestMatchWithRange(item.phrase, transcript);
      return {
        phrase: item.phrase,
        translation: item.translation,
        timestamp: matchResult.start / 1000,
        duration: (matchResult.end - matchResult.start) / 1000,
      };
    });

    // Refine timestamps using Whisper if videoId is provided
    // NOTE: Whisper disabled in production - Python not available in serverless
    const enableWhisper = process.env.NODE_ENV !== 'production';

    if (videoId && enableWhisper) {
      try {
        console.log(`[SELECT-PHRASES] Calling refineBatch with ${selectedPhrases.length} phrases`);

        // Call refineBatch directly instead of using fetch
        const refinedPhrases = await refineBatch(videoId, selectedPhrases as PhraseToRefine[]);

        // Sort by confidence score (Whisper matching quality) and take top 20
        const sortedPhrases = refinedPhrases
          .filter((p: any) => p.audioUrl) // Only keep phrases with audio
          .sort((a: any, b: any) => {
            // Prioritize phrases with confidence scores
            const confA = a.confidence || 0;
            const confB = b.confidence || 0;
            return confB - confA; // Descending order
          })
          .slice(0, 20); // Take top 20

        console.log(`Selected ${sortedPhrases.length} out of ${refinedPhrases.length} phrases based on Whisper confidence`);

        return NextResponse.json({ phrases: sortedPhrases });
      } catch (error) {
        console.error('Whisper refinement failed, using fuzzy match timestamps:', error);
      }
    }

    // Fallback: Return phrases with placeholder audio (production mode)
    const fallbackPhrases = selectedPhrases.slice(0, 20).map((p: any) => ({
      ...p,
      audioUrl: '/api/audio/placeholder_unavailable.mp3',
      confidence: 0.5
    }));

    console.log(`[SELECT-PHRASES] Returning ${fallbackPhrases.length} phrases (Whisper ${enableWhisper ? 'enabled' : 'disabled'})`);
    return NextResponse.json({ phrases: fallbackPhrases });
  } catch (error) {
    console.error('Phrase selection error:', error);
    return NextResponse.json(
      { error: 'Failed to select phrases' },
      { status: 500 }
    );
  }
}

function findBestMatchWithRange(
  phrase: string,
  transcript: TranscriptItem[]
): { start: number; end: number } {
  const phraseLower = phrase.toLowerCase().replace(/[^\w\s]/g, '');
  const phraseWords = phraseLower.split(/\s+/).filter(w => w.length > 0);

  let bestMatch = { start: 0, end: 3000, score: 0 };

  // Try to find the phrase across multiple transcript items
  for (let i = 0; i < transcript.length; i++) {
    for (let j = i; j < Math.min(i + 5, transcript.length); j++) {
      // Combine transcript items from i to j
      const combinedText = transcript
        .slice(i, j + 1)
        .map(item => item.text.toLowerCase().replace(/[^\w\s]/g, ''))
        .join(' ');

      const score = calculatePhraseScore(phraseWords, combinedText);

      if (score > bestMatch.score) {
        bestMatch = {
          start: transcript[i].offset,
          end: transcript[j].offset + transcript[j].duration,
          score,
        };
      }
    }
  }

  return { start: bestMatch.start, end: bestMatch.end };
}

function calculatePhraseScore(phraseWords: string[], transcriptText: string): number {
  const transcriptWords = transcriptText.split(/\s+/).filter(w => w.length > 0);

  // Calculate how many phrase words appear in the transcript text in order
  let matchCount = 0;
  let transcriptIndex = 0;

  for (const phraseWord of phraseWords) {
    let bestMatchScore = 0;
    let bestMatchIndex = -1;

    // Search for the best matching word in remaining transcript
    for (let i = transcriptIndex; i < transcriptWords.length; i++) {
      const tw = transcriptWords[i];
      let score = 0;

      // Exact match
      if (tw === phraseWord) {
        score = 1.0;
      }
      // One contains the other
      else if (tw.includes(phraseWord) || phraseWord.includes(tw)) {
        score = 0.8;
      }
      // Similar start (for plurals, verb forms, etc.)
      else if (phraseWord.length > 3 && tw.length > 3) {
        const commonPrefix = getCommonPrefixLength(phraseWord, tw);
        if (commonPrefix >= Math.min(phraseWord.length, tw.length) * 0.7) {
          score = 0.6;
        }
      }

      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestMatchIndex = i;
      }

      // Stop searching if we found a good match
      if (score >= 0.8) break;
    }

    if (bestMatchScore > 0.5) {
      matchCount += bestMatchScore;
      transcriptIndex = bestMatchIndex + 1;
    } else {
      transcriptIndex++;
    }
  }

  // Score based on matched words and length similarity
  const matchRatio = matchCount / phraseWords.length;
  const lengthRatio = Math.min(phraseWords.length, transcriptWords.length) /
                      Math.max(phraseWords.length, transcriptWords.length);

  return matchRatio * 0.8 + lengthRatio * 0.2;
}

function getCommonPrefixLength(str1: string, str2: string): number {
  let i = 0;
  while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
    i++;
  }
  return i;
}
