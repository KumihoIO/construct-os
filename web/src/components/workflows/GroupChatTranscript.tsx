/**
 * GroupChatTranscript — Renders a group_chat step's transcript as a chat thread.
 *
 * Each turn is displayed as a speaker bubble with round indicator.
 * Moderator turns get a distinct accent, participants get assigned colors.
 */

import { Bot, Crown, MessageCircle } from 'lucide-react';
import type { TranscriptEntry } from '@/types/api';

// Participant color palette — deterministic by speaker name
const SPEAKER_COLORS: { bg: string; border: string; text: string; badge: string }[] = [
  { bg: 'rgba(99,102,241,0.08)', border: '#6366f133', text: '#a5b4fc', badge: '#6366f1' },
  { bg: 'rgba(236,72,153,0.08)', border: '#ec489933', text: '#f9a8d4', badge: '#ec4899' },
  { bg: 'rgba(234,179,8,0.08)',  border: '#eab30833', text: '#fde047', badge: '#eab308' },
  { bg: 'rgba(20,184,166,0.08)', border: '#14b8a633', text: '#5eead4', badge: '#14b8a6' },
  { bg: 'rgba(249,115,22,0.08)', border: '#f9731633', text: '#fdba74', badge: '#f97316' },
  { bg: 'rgba(139,92,246,0.08)', border: '#8b5cf633', text: '#c4b5fd', badge: '#8b5cf6' },
];

const MODERATOR_STYLE = {
  bg: 'rgba(168,85,247,0.10)',
  border: '#a855f733',
  text: '#c084fc',
  badge: '#a855f7',
};

function speakerColor(name: string, isModerator: boolean): typeof MODERATOR_STYLE {
  if (isModerator) return MODERATOR_STYLE;
  // Hash the name to pick a consistent color
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0]!;
}

export default function GroupChatTranscript({
  transcript,
  topic,
  status,
}: {
  transcript: TranscriptEntry[];
  topic?: string;
  status?: string;
}) {
  if (!transcript || transcript.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center" style={{ color: 'var(--pc-text-muted)' }}>
        <MessageCircle className="h-6 w-6 mb-2" style={{ color: 'var(--pc-text-faint)' }} />
        <p className="text-xs">
          {status === 'running' ? 'Discussion starting...' : 'No transcript available'}
        </p>
      </div>
    );
  }

  // Track unique speakers for the header
  const speakers = [...new Set(transcript.map((t) => t.speaker))];
  const maxRound = transcript.length > 0 ? Math.max(...transcript.map((t) => t.round)) : 0;

  return (
    <div className="flex flex-col gap-1">
      {/* Topic + participants header */}
      {(topic || speakers.length > 0) && (
        <div
          className="rounded-lg px-3 py-2 mb-1"
          style={{ background: 'var(--pc-bg-elevated)', border: '1px solid var(--pc-border)' }}
        >
          {topic && (
            <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--pc-text-primary)' }}>
              {topic}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {speakers.map((name) => {
              const isMod = name.toLowerCase().includes('moderator');
              const c = speakerColor(name, isMod);
              return (
                <span
                  key={name}
                  className="px-1.5 py-0.5 rounded text-[9px] font-medium inline-flex items-center gap-1"
                  style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                >
                  {isMod ? <Crown size={8} /> : <Bot size={8} />}
                  {name}
                </span>
              );
            })}
            <span className="text-[9px] self-center" style={{ color: 'var(--pc-text-faint)' }}>
              {maxRound} round{maxRound !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Transcript messages */}
      {transcript.map((entry, i) => {
        const isMod = entry.speaker.toLowerCase().includes('moderator');
        const isSynthesis = entry.speaker.toLowerCase().includes('synthesis');
        const c = speakerColor(entry.speaker, isMod);
        const prevRound = i > 0 ? (transcript[i - 1]?.round ?? 0) : 0;
        const showRoundDivider = entry.round > prevRound && entry.round > 1;

        return (
          <div key={`${entry.round}-${entry.speaker}-${i}`}>
            {showRoundDivider && (
              <div className="flex items-center gap-2 my-1.5 px-2">
                <div className="flex-1 h-px" style={{ background: 'var(--pc-border)' }} />
                <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pc-text-faint)' }}>
                  Round {entry.round}
                </span>
                <div className="flex-1 h-px" style={{ background: 'var(--pc-border)' }} />
              </div>
            )}
            <div
              className="rounded-lg px-3 py-2 transition-colors"
              style={{
                background: c.bg,
                borderLeft: `3px solid ${c.badge}`,
              }}
            >
              {/* Speaker header */}
              <div className="flex items-center gap-1.5 mb-1">
                {isMod ? (
                  <Crown size={10} style={{ color: c.badge }} />
                ) : (
                  <Bot size={10} style={{ color: c.badge }} />
                )}
                <span className="text-[10px] font-semibold" style={{ color: c.text }}>
                  {entry.speaker}
                </span>
                {isSynthesis && (
                  <span
                    className="text-[8px] px-1 py-0.5 rounded font-medium uppercase"
                    style={{ background: '#a855f722', color: '#c084fc' }}
                  >
                    Synthesis
                  </span>
                )}
              </div>
              {/* Message content */}
              <div
                className="text-[11px] leading-relaxed whitespace-pre-wrap"
                style={{ color: 'var(--pc-text-secondary)' }}
              >
                {entry.content}
              </div>
            </div>
          </div>
        );
      })}

      {/* Running indicator */}
      {status === 'running' && (
        <div
          className="rounded-lg px-3 py-2 flex items-center gap-2"
          style={{ background: 'rgba(234,179,8,0.06)', borderLeft: '3px solid #eab30844' }}
        >
          <div className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#eab308', animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#eab308', animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#eab308', animationDelay: '300ms' }} />
          </div>
          <span className="text-[10px]" style={{ color: '#eab308' }}>
            Agent is speaking...
          </span>
        </div>
      )}
    </div>
  );
}
