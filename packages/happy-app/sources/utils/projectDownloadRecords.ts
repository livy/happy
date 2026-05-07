import { MMKV } from 'react-native-mmkv';
import * as FileSystem from 'expo-file-system/legacy';

const storage = new MMKV();
const STORAGE_KEY = 'project-download-records-v1';
const MAX_RECORDS = 200;

export interface ProjectDownloadRecord {
    sessionId: string;
    remotePath: string;
    localUri: string;
    fileName: string;
    mimeType: string;
    downloadedAt: number;
    size?: number;
}

function recordKey(sessionId: string, remotePath: string): string {
    return `${sessionId}\u0000${remotePath}`;
}

export function loadProjectDownloadRecords(): Record<string, ProjectDownloadRecord> {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        return parsed as Record<string, ProjectDownloadRecord>;
    } catch (error) {
        console.warn('Failed to parse project download records:', error);
        return {};
    }
}

function saveProjectDownloadRecords(records: Record<string, ProjectDownloadRecord>) {
    const entries = Object.entries(records)
        .sort(([, a], [, b]) => b.downloadedAt - a.downloadedAt)
        .slice(0, MAX_RECORDS);
    storage.set(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export async function getProjectDownloadRecord(sessionId: string, remotePath: string): Promise<ProjectDownloadRecord | null> {
    const records = loadProjectDownloadRecords();
    const record = records[recordKey(sessionId, remotePath)];
    if (!record) {
        return null;
    }
    if (record.localUri) {
        try {
            const info = await FileSystem.getInfoAsync(record.localUri);
            if (!info.exists) {
                delete records[recordKey(sessionId, remotePath)];
                saveProjectDownloadRecords(records);
                return null;
            }
        } catch {
            return null;
        }
    }
    return record;
}

export function saveProjectDownloadRecord(record: ProjectDownloadRecord) {
    const records = loadProjectDownloadRecords();
    records[recordKey(record.sessionId, record.remotePath)] = record;
    saveProjectDownloadRecords(records);
}
