import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { sessionReadFileChunk } from '@/sync/ops';
import { apiSocket } from '@/sync/apiSocket';

const DOWNLOADS_DIR_NAME = 'Happy Downloads';
const DOWNLOAD_CHUNK_BYTES = 12 * 1024;
const DOWNLOAD_CHUNK_MAX_ATTEMPTS = 6;
const DOWNLOAD_RETRY_BASE_DELAY_MS = 800;

export interface SessionFileDownloadProgress {
    bytesDownloaded: number;
    totalBytes?: number;
    done: boolean;
}

export interface SaveSessionFileOptions {
    onProgress?: (progress: SessionFileDownloadProgress) => void;
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getFileName(filePath: string): string {
    const basename = filePath.split(/[\\/]/).pop() || 'download';
    const sanitized = basename
        .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
        .replace(/^\.+$/, 'download')
        .trim();
    return sanitized || 'download';
}

function getMimeType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension ? MIME_TYPES_BY_EXTENSION[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}

async function ensureDownloadsDirectory(): Promise<string> {
    const baseDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (!baseDirectory) {
        throw new Error('File downloads are not available on this device.');
    }

    const downloadsDirectory = `${baseDirectory}${DOWNLOADS_DIR_NAME}/`;
    const info = await FileSystem.getInfoAsync(downloadsDirectory);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(downloadsDirectory, { intermediates: true });
    }
    return downloadsDirectory;
}

async function downloadInBrowser(contentBase64: string, fileName: string, mimeType: string): Promise<string> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('Browser downloads are not available.');
    }

    const link = document.createElement('a');
    link.href = `data:${mimeType};base64,${contentBase64}`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return fileName;
}

async function readRemoteFileInChunks(
    sessionId: string,
    filePath: string,
    onChunk: (contentBase64: string, offset: number, length: number) => Promise<void>,
    onProgress?: (progress: SessionFileDownloadProgress) => void
): Promise<void> {
    let offset = 0;
    let bytesDownloaded = 0;
    let totalBytes: number | undefined;

    while (true) {
        const response = await readRemoteFileChunkWithRetry(sessionId, filePath, offset);
        if (!response.success || typeof response.content !== 'string') {
            throw new Error(response.error || 'Failed to download file.');
        }

        const chunkLength = response.length ?? 0;
        totalBytes = response.totalSize ?? totalBytes;
        if (response.content.length > 0 || chunkLength > 0) {
            await onChunk(response.content, response.offset ?? offset, chunkLength);
        }
        bytesDownloaded = Math.max(bytesDownloaded, (response.offset ?? offset) + chunkLength);
        onProgress?.({
            bytesDownloaded,
            totalBytes,
            done: response.done ?? false,
        });

        if (response.done) {
            return;
        }
        if (chunkLength <= 0) {
            throw new Error('Download stalled while reading file.');
        }
        offset = (response.offset ?? offset) + chunkLength;
    }
}

type ReadChunkResult = Awaited<ReturnType<typeof sessionReadFileChunk>>;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableDownloadError(errorMessage: string): boolean {
    const normalized = errorMessage.toLowerCase();
    return normalized.includes('network request failed')
        || normalized.includes('timeout')
        || normalized.includes('transport')
        || normalized.includes('disconnected')
        || normalized.includes('rpc call failed');
}

function formatDownloadErrorContext(filePath: string, offset: number, attempt: number, errorMessage: string): string {
    return `Failed to download "${getFileName(filePath)}" at byte ${offset} on attempt ${attempt}: ${errorMessage}`;
}

async function readRemoteFileChunkWithRetry(
    sessionId: string,
    filePath: string,
    offset: number
): Promise<ReadChunkResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= DOWNLOAD_CHUNK_MAX_ATTEMPTS; attempt += 1) {
        if (apiSocket.getStatus() !== 'connected') {
            try {
                await apiSocket.waitForConnected(20_000);
            } catch (error) {
                lastError = error instanceof Error ? error.message : 'Socket is not connected';
                if (attempt === DOWNLOAD_CHUNK_MAX_ATTEMPTS) {
                    return {
                        success: false,
                        error: formatDownloadErrorContext(filePath, offset, attempt, lastError),
                    };
                }
                await sleep(DOWNLOAD_RETRY_BASE_DELAY_MS * attempt);
                continue;
            }
        }

        const response = await sessionReadFileChunk(sessionId, filePath, offset, DOWNLOAD_CHUNK_BYTES);
        if (response.success) {
            return response;
        }

        lastError = response.error || 'Failed to download file.';
        if (!isRetryableDownloadError(lastError) || attempt === DOWNLOAD_CHUNK_MAX_ATTEMPTS) {
            return {
                ...response,
                error: formatDownloadErrorContext(filePath, offset, attempt, lastError),
            };
        }

        await sleep(DOWNLOAD_RETRY_BASE_DELAY_MS * attempt);
    }

    return {
        success: false,
        error: formatDownloadErrorContext(
            filePath,
            offset,
            DOWNLOAD_CHUNK_MAX_ATTEMPTS,
            lastError || 'Failed to download file.'
        ),
    };
}

export async function saveSessionFileToDevice(
    sessionId: string,
    filePath: string,
    options: SaveSessionFileOptions = {}
): Promise<{ uri: string; fileName: string; mimeType: string }> {
    const fileName = getFileName(filePath);
    const mimeType = getMimeType(fileName);

    if (Platform.OS === 'web') {
        const chunks: string[] = [];
        await readRemoteFileInChunks(sessionId, filePath, async (content) => {
            chunks.push(content);
        }, options.onProgress);
        const uri = await downloadInBrowser(chunks.join(''), fileName, mimeType);
        return { uri, fileName, mimeType };
    }

    const downloadsDirectory = await ensureDownloadsDirectory();
    const fileUri = `${downloadsDirectory}${encodeURIComponent(fileName)}`;
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    let isFirstChunk = true;
    let wroteChunk = false;
    await readRemoteFileInChunks(sessionId, filePath, async (content) => {
        await FileSystem.writeAsStringAsync(fileUri, content, {
            encoding: FileSystem.EncodingType.Base64,
            append: !isFirstChunk,
        });
        isFirstChunk = false;
        wroteChunk = true;
    }, options.onProgress);
    if (!wroteChunk) {
        await FileSystem.writeAsStringAsync(fileUri, '');
    }
    return { uri: fileUri, fileName, mimeType };
}

export async function openDownloadedFileExternally(downloaded: { uri: string; fileName: string; mimeType: string }): Promise<void> {
    if (Platform.OS === 'web') {
        return;
    }

    if (Platform.OS === 'android') {
        try {
            const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);
            await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
                data: contentUri,
                type: downloaded.mimeType,
                flags: 1,
            });
            return;
        } catch (error) {
            console.warn('Failed to open file with Android intent, falling back to share sheet:', error);
        }
    }

    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloaded.uri, {
            mimeType: downloaded.mimeType,
            dialogTitle: downloaded.fileName,
        });
        return;
    }

    throw new Error(`File saved to ${downloaded.uri}, but no external opener is available.`);
}

export async function openSessionFileExternally(sessionId: string, filePath: string): Promise<void> {
    const downloaded = await saveSessionFileToDevice(sessionId, filePath);
    await openDownloadedFileExternally(downloaded);
}
