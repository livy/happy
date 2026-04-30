import fs from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';

import type { ApiClient } from '@/api/api';
import type { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import packageJson from '../../package.json';

export type SyncLocalSessionsFlavor = 'claude' | 'all';

export interface SyncLocalSessionsOptions {
  limit?: number;
  cursor?: string | null;
  flavor?: SyncLocalSessionsFlavor;
}

export interface SyncLocalSessionsResultItem {
  id: string;
  tag: string;
  nativeSessionId: string;
  path: string;
  updatedAt: number;
  flavor: 'claude';
}

export interface SyncLocalSessionsResult {
  imported: number;
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
  sessions: SyncLocalSessionsResultItem[];
}

interface SyncLocalSessionsContext {
  api: ApiClient;
  machineId: string;
  options?: SyncLocalSessionsOptions;
}

interface ClaudeHistoryFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

interface CursorValue {
  mtimeMs: number;
  sessionId: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function syncLocalSessions({
  api,
  machineId,
  options = {}
}: SyncLocalSessionsContext): Promise<SyncLocalSessionsResult> {
  const flavor = options.flavor ?? 'all';
  const limit = normalizeLimit(options.limit);

  if (flavor !== 'all' && flavor !== 'claude') {
    throw new Error(`Unsupported local session flavor: ${flavor}`);
  }

  const cursor = decodeCursor(options.cursor);
  const allFiles = await listClaudeHistoryFiles();
  const files = cursor
    ? allFiles.filter((file) => compareHistoryFiles(file, cursor) > 0)
    : allFiles;
  const page = files.slice(0, limit);
  const overflow = files.length > limit ? files[limit] : null;
  const importedSessions: SyncLocalSessionsResultItem[] = [];

  // Import oldest-to-newest within the page. The explicit timestamps keep the
  // history order stable, while this also behaves sensibly on older servers.
  for (const file of [...page].reverse()) {
    const detail = await readClaudeHistoryFile(file);
    if (!detail.hasConversationContent) {
      continue;
    }

    const tag = `local-import:${machineId}:claude:${file.sessionId}`;
    const updatedAt = detail.updatedAt || file.mtimeMs;
    const metadata: Metadata = {
      path: detail.cwd || os.homedir(),
      host: os.hostname(),
      version: packageJson.version,
      os: os.platform(),
      machineId,
      homeDir: os.homedir(),
      happyHomeDir: configuration.happyHomeDir,
      happyLibDir: projectPath(),
      happyToolsDir: resolve(projectPath(), 'tools', 'unpacked'),
      startedFromDaemon: false,
      startedBy: 'terminal',
      lifecycleState: 'archived',
      lifecycleStateSince: updatedAt,
      flavor: 'claude',
      claudeSessionId: file.sessionId,
      summary: detail.summary ? { text: detail.summary, updatedAt } : undefined,
    };

    const session = await api.getOrCreateSession({
      tag,
      metadata,
      state: null,
      active: false,
      activeAt: updatedAt,
      createdAt: updatedAt,
      updatedAt,
    });

    if (session) {
      importedSessions.push({
        id: session.id,
        tag,
        nativeSessionId: file.sessionId,
        path: metadata.path,
        updatedAt,
        flavor: 'claude',
      });
    }
  }

  return {
    imported: importedSessions.length,
    scanned: page.length,
    hasMore: overflow !== null,
    nextCursor: overflow && page.length > 0
      ? encodeCursor({ mtimeMs: page[page.length - 1].mtimeMs, sessionId: page[page.length - 1].sessionId })
      : null,
    sessions: importedSessions.sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function getClaudeProjectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(os.homedir(), '.claude'), 'projects');
}

async function listClaudeHistoryFiles(): Promise<ClaudeHistoryFile[]> {
  const projectsDir = getClaudeProjectsDir();
  let projectDirs;
  try {
    projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: ClaudeHistoryFile[] = [];
  await Promise.all(projectDirs.map(async (projectDir) => {
    if (!projectDir.isDirectory()) {
      return;
    }

    const projectDirPath = join(projectsDir, projectDir.name);
    let entries;
    try {
      entries = await fs.readdir(projectDirPath, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        return;
      }

      const filePath = join(projectDirPath, entry.name);
      try {
        const stat = await fs.stat(filePath);
        files.push({
          sessionId: entry.name.slice(0, -'.jsonl'.length),
          filePath,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }));
  }));

  return files.sort(compareHistoryFiles);
}

function compareHistoryFiles(a: ClaudeHistoryFile, b: ClaudeHistoryFile | CursorValue): number {
  if (a.mtimeMs !== b.mtimeMs) {
    return b.mtimeMs - a.mtimeMs;
  }
  return b.sessionId.localeCompare(a.sessionId);
}

async function readClaudeHistoryFile(file: ClaudeHistoryFile): Promise<{
  cwd: string | null;
  summary: string | null;
  updatedAt: number;
  hasConversationContent: boolean;
}> {
  let raw = '';
  try {
    raw = await fs.readFile(file.filePath, 'utf8');
  } catch {
    return { cwd: null, summary: null, updatedAt: file.mtimeMs, hasConversationContent: false };
  }

  let cwd: string | null = null;
  let summary: string | null = null;
  let updatedAt = file.mtimeMs;
  let hasConversationContent = false;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const record = JSON.parse(trimmed) as {
        cwd?: unknown;
        timestamp?: unknown;
        type?: unknown;
        summary?: unknown;
        message?: unknown;
      };

      if (typeof record.cwd === 'string' && record.cwd.length > 0) {
        cwd = record.cwd;
      }

      if (typeof record.timestamp === 'string') {
        const timestamp = Date.parse(record.timestamp);
        if (Number.isFinite(timestamp)) {
          updatedAt = timestamp;
        }
      }

      if (record.type === 'summary' && typeof record.summary === 'string' && record.summary.length > 0) {
        summary = record.summary;
      }

      if (!hasConversationContent && hasClaudeMessageContent(record)) {
        hasConversationContent = true;
      }
    } catch {
      // Keep scanning when a single JSONL row is malformed or partially written.
    }
  }

  return { cwd, summary, updatedAt, hasConversationContent };
}

function hasClaudeMessageContent(record: { type?: unknown; message?: unknown }): boolean {
  if (record.type !== 'user' && record.type !== 'assistant') {
    return false;
  }

  const message = record.message;
  if (!message || typeof message !== 'object') {
    return false;
  }

  const content = (message as { content?: unknown }).content;
  return hasMeaningfulContent(content);
}

function hasMeaningfulContent(content: unknown): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const contentItem = item as {
      type?: unknown;
      text?: unknown;
      content?: unknown;
      name?: unknown;
      input?: unknown;
    };

    if (typeof contentItem.text === 'string' && contentItem.text.trim().length > 0) {
      return true;
    }

    if (hasMeaningfulContent(contentItem.content)) {
      return true;
    }

    if (contentItem.type === 'tool_use') {
      return typeof contentItem.name === 'string' && contentItem.name.trim().length > 0
        || contentItem.input !== undefined;
    }

    return false;
  });
}

function encodeCursor(cursor: CursorValue): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): CursorValue | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorValue>;
    if (typeof parsed.mtimeMs === 'number' && typeof parsed.sessionId === 'string') {
      return { mtimeMs: parsed.mtimeMs, sessionId: parsed.sessionId };
    }
  } catch {
    // Fall through to a clear validation error below.
  }

  throw new Error('Invalid local session sync cursor');
}
