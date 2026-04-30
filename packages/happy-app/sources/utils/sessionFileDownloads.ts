import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { sessionReadFile } from '@/sync/ops';

const DOWNLOADS_DIR_NAME = 'Happy Downloads';

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

export async function saveSessionFileToDevice(sessionId: string, filePath: string): Promise<{ uri: string; fileName: string; mimeType: string }> {
    const response = await sessionReadFile(sessionId, filePath);
    if (!response.success || typeof response.content !== 'string') {
        throw new Error(response.error || 'Failed to download file.');
    }

    const fileName = getFileName(filePath);
    const mimeType = getMimeType(fileName);

    if (Platform.OS === 'web') {
        const uri = await downloadInBrowser(response.content, fileName, mimeType);
        return { uri, fileName, mimeType };
    }

    const downloadsDirectory = await ensureDownloadsDirectory();
    const fileUri = `${downloadsDirectory}${encodeURIComponent(fileName)}`;
    await FileSystem.writeAsStringAsync(fileUri, response.content, { encoding: FileSystem.EncodingType.Base64 });
    return { uri: fileUri, fileName, mimeType };
}

export async function openSessionFileExternally(sessionId: string, filePath: string): Promise<void> {
    const downloaded = await saveSessionFileToDevice(sessionId, filePath);

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
