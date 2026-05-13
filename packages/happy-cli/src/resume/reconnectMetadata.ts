import { decodeBase64 } from '@/api/encryption';
import type { Metadata } from '@/api/types';

export function parseReconnectMetadata(encoded: string | undefined): Partial<Metadata> | null {
  if (!encoded) {
    return null;
  }

  try {
    const decoded = new TextDecoder().decode(decodeBase64(encoded));
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as Partial<Metadata>;
  } catch {
    return null;
  }
}

export function mergeReconnectMetadata(current: Metadata, previous: Partial<Metadata> | null): Metadata {
  if (!previous) {
    return current;
  }

  return {
    ...previous,
    ...current,
    archivedBy: undefined,
    archiveReason: undefined,
    lifecycleState: 'running',
  };
}
