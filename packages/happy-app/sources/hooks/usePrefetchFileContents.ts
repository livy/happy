import type { GitStatusFiles } from '@/sync/gitStatusFiles';

export function usePrefetchFileContents(_sessionId: string, _gitStatusFiles: GitStatusFiles | null) {
    // File contents and diffs are intentionally loaded only after the user opens a file.
}
