import { describe, expect, it, vi } from 'vitest';

const { mockSessionRPC } = vi.hoisted(() => ({
    mockSessionRPC: vi.fn(),
}));

vi.mock('./apiSocket', () => ({
    apiSocket: {
        sessionRPC: mockSessionRPC,
    },
}));

vi.mock('./sync', () => ({
    sync: {},
}));

import { sessionBash } from './ops';

describe('sessionBash', () => {
    it('returns a failure response when the RPC decrypts to null', async () => {
        mockSessionRPC.mockResolvedValueOnce(null);

        const result = await sessionBash('session-1', {
            command: 'git status',
            cwd: '/tmp/repo',
        });

        expect(result).toEqual({
            success: false,
            stdout: '',
            stderr: 'Session bash RPC returned an empty response',
            exitCode: -1,
            error: 'Session bash RPC returned an empty response',
        });
    });
});
