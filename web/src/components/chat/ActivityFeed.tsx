import { Bot } from 'lucide-react';
import type { ActivityEvent } from './types';
import ActivityIndicator from './ActivityIndicator';

interface ActivityFeedProps {
  activities: ActivityEvent[];
  /** Max visible items. */
  limit?: number;
  compact?: boolean;
}

/** Feed of transient activity events shown while agent is working. */
export default function ActivityFeed({ activities, limit = 8, compact }: ActivityFeedProps) {
  const visible = activities.slice(-limit);
  const avatarSize = compact ? 'w-7 h-7 rounded-xl' : 'w-9 h-9 rounded-2xl';
  const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const bubbleRadius = compact ? 'rounded-xl' : 'rounded-2xl';
  const bubblePadding = compact ? 'px-3 py-2.5' : 'px-4 py-3';

  return (
    <div className={`flex items-start gap-${compact ? '2.5' : '3'} animate-fade-in`}>
      {!compact && (
        <div
          className={`flex-shrink-0 ${avatarSize} flex items-center justify-center border`}
          style={{ background: 'var(--pc-bg-elevated)', borderColor: 'var(--pc-border)' }}
        >
          <Bot className={iconSize} style={{ color: 'var(--pc-accent)' }} />
        </div>
      )}
      <div
        className={`${bubbleRadius} ${bubblePadding} border space-y-2 ${compact ? 'w-full' : 'max-w-[75%]'}`}
        style={{ background: 'var(--pc-bg-elevated)', borderColor: 'var(--pc-border)' }}
      >
        {visible.map((evt, i) => (
          <ActivityIndicator
            key={evt.id}
            event={evt}
            isLatest={i === visible.length - 1}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
