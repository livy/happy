import { describe, expect, it } from 'vitest';
import {
    formatFileSize,
    getRelativeProjectPath,
    isKnownBinaryFile,
    isKnownTextFile,
    isLikelyBinaryBytes,
    joinRemotePath,
    shouldPreviewAsText,
} from './projectFiles';

describe('projectFiles', () => {
    it('classifies common text and binary files', () => {
        expect(isKnownTextFile('src/App.tsx')).toBe(true);
        expect(isKnownTextFile('README')).toBe(true);
        expect(isKnownTextFile('.env')).toBe(true);
        expect(isKnownBinaryFile('image.PNG')).toBe(true);
        expect(isKnownBinaryFile('archive.zip')).toBe(true);
    });

    it('guards preview decisions by type and size', () => {
        expect(shouldPreviewAsText('notes.md', 2 * 1024 * 1024)).toBe(true);
        expect(shouldPreviewAsText('data.bin', 2 * 1024 * 1024)).toBe(false);
        expect(shouldPreviewAsText('photo.jpg', 100)).toBe(false);
        expect(shouldPreviewAsText('unknown', 100)).toBe(true);
    });

    it('detects likely binary byte content', () => {
        expect(isLikelyBinaryBytes(new Uint8Array([65, 66, 67]), 'ABC')).toBe(false);
        expect(isLikelyBinaryBytes(new Uint8Array([65, 0, 67]), 'A\0C')).toBe(true);
    });

    it('formats sizes and paths', () => {
        expect(formatFileSize(10)).toBe('10 B');
        expect(formatFileSize(2048)).toBe('2 KB');
        expect(joinRemotePath('/repo/src', 'App.tsx')).toBe('/repo/src/App.tsx');
        expect(getRelativeProjectPath('/repo/src/App.tsx', '/repo')).toBe('src/App.tsx');
    });
});
