import { CircleIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { ConnectionState } from '../../tau/types';

export function ConnectionDot({ state }: { state: ConnectionState }) {
  return (
    <CircleIcon
      className={cn(
        'size-2 fill-current',
        state === 'connected' && 'text-emerald-500',
        state === 'connecting' && 'text-amber-500',
        state === 'disconnected' && 'text-destructive'
      )}
    />
  );
}
