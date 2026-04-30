import fs from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';

import type { ApiClient } from '@/api/api';
import type { Metadata } from '@/api/types';
import type { RawJSONLines } from '@/claude/types';
import {
  mapClaudeLogMessageToSessionEnvelopes,
  type ClaudeSessionProtocolState,
} from '@/claude/utils/sessionProtocolMapper';
import {
  mapCodexMcpMessageToSessionEnvelopes,
  type CodexTurnState,
} from '@/codex/utils/sessionProtocolMapper';
import { configuration } from '@/configuration';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import { projectPath } from '@/projectPath';
import packageJson from '../../package.json';

export type SyncLocalSessionsFlavor = 'claude' | 'codex' | 'all';

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
  title: string | null;
  updatedAt: number;
  flavor: 'claude' | 'codex';
}

export interface SyncLocalSessionsResult {
  imported: number;
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
  sessions: SyncLocalSessionsResultItem[];
}

export interface SyncLocalSessionMessagesOptions {
  nativeSessionId: string;
  limit?: number;
  flavor?: SyncLocalSessionsFlavor;
  beforeCreatedAt?: number | null;
}

export interface SyncLocalSessionMessagesResult {
  found: boolean;
  records: Array<{
    localId: string;
    createdAt: number;
    record: LocalSyncRawRecord;
  }>;
  hasMore: boolean;
}

interface SyncLocalSessionsContext {
  api: ApiClient;
  machineId: string;
  options?: SyncLocalSessionsOptions;
}

interface ClaudeHistoryFile {
  flavor: 'claude';
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

interface CodexHistoryFile {
  flavor: 'codex';
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

type LocalHistoryFile = ClaudeHistoryFile | CodexHistoryFile;

interface CursorValue {
  mtimeMs: number;
  sessionId: string;
}

type LocalSyncRawRecord =
  | {
      role: 'user';
      content: {
        type: 'text';
        text: string;
      };
      meta: {
        sentFrom: 'cli';
        displayText?: string;
      };
    }
  | {
      role: 'session';
      content: {
        type: 'session';
        data: unknown;
      };
      meta: {
        sentFrom: 'cli';
      };
    };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 1000;
const MAX_MESSAGE_LIMIT = 2000;

export async function syncLocalSessions({
  api,
  machineId,
  options = {}
}: SyncLocalSessionsContext): Promise<SyncLocalSessionsResult> {
  const flavor = options.flavor ?? 'all';
  const limit = normalizeLimit(options.limit);

  if (flavor !== 'all' && flavor !== 'claude' && flavor !== 'codex') {
    throw new Error(`Unsupported local session flavor: ${flavor}`);
  }

  const cursor = decodeCursor(options.cursor);
  const allFiles = await listLocalHistoryFiles(flavor);
  const codexSessionTitles = flavor === 'all' || flavor === 'codex'
    ? await readCodexSessionTitles()
    : new Map<string, string>();
  const files = cursor
    ? allFiles.filter((file) => compareHistoryFiles(file, cursor) > 0)
    : allFiles;
  const page = files.slice(0, limit);
  const overflow = files.length > limit ? files[limit] : null;
  const importedSessions: SyncLocalSessionsResultItem[] = [];

  // Import oldest-to-newest within the page. The explicit timestamps keep the
  // history order stable, while this also behaves sensibly on older servers.
  for (const file of [...page].reverse()) {
    const detail = file.flavor === 'codex'
      ? await readCodexHistoryFile(file, codexSessionTitles.get(file.sessionId) ?? null)
      : await readClaudeHistoryFile(file);
    if (!detail.hasConversationContent) {
      continue;
    }

    const tag = `local-import:${machineId}:${file.flavor}:${file.sessionId}`;
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
      flavor: file.flavor,
      ...(detail.title ? { name: detail.title } : {}),
      ...(file.flavor === 'codex'
        ? { codexThreadId: file.sessionId }
        : { claudeSessionId: file.sessionId }),
      ...(detail.currentModelCode ? {
        currentModelCode: detail.currentModelCode,
        models: [{ code: detail.currentModelCode, value: detail.currentModelCode }],
      } : {}),
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
        title: detail.title,
        updatedAt,
        flavor: file.flavor,
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

export async function syncLocalSessionMessages(options: SyncLocalSessionMessagesOptions): Promise<SyncLocalSessionMessagesResult> {
  const limit = normalizeMessageLimit(options.limit);
  const flavor = options.flavor ?? 'all';
  if (flavor !== 'all' && flavor !== 'claude' && flavor !== 'codex') {
    throw new Error(`Unsupported local session flavor: ${flavor}`);
  }

  const files = await listLocalHistoryFiles(flavor);
  const file = files.find((item) => item.sessionId === options.nativeSessionId);
  if (!file) {
    return { found: false, records: [], hasMore: false };
  }

  if (file.flavor === 'codex') {
    return readCodexHistoryMessages(file, limit, options.beforeCreatedAt);
  }

  const records = await readClaudeHistoryRecords(file);
  const protocolState: ClaudeSessionProtocolState = {
    currentTurnId: null,
    uuidToProviderSubagent: new Map(),
    taskPromptToSubagents: new Map(),
    providerSubagentToSessionSubagent: new Map(),
    subagentTitles: new Map(),
    bufferedSubagentMessages: new Map(),
    hiddenParentToolCalls: new Set(),
    startedSubagents: new Set(),
    activeSubagents: new Set(),
  };

  const mapped: SyncLocalSessionMessagesResult['records'] = [];
  for (const record of records) {
    const result = mapClaudeLogMessageToSessionEnvelopes(record, protocolState);
    protocolState.currentTurnId = result.currentTurnId;

    const rawUuid = typeof (record as { uuid?: unknown }).uuid === 'string'
      ? (record as { uuid: string }).uuid
      : `${file.sessionId}:${mapped.length}`;

    for (let i = 0; i < result.envelopes.length; i++) {
      const envelope = result.envelopes[i];
      const createdAt = parseRecordTimestamp((record as { timestamp?: unknown }).timestamp) ?? file.mtimeMs;
      const order = mapped.length;
      mapped.push({
        localId: `local-claude:${file.sessionId}:${createdAt}:${order}:${rawUuid}:${i}`,
        createdAt,
        record: {
          role: 'session',
          content: {
            type: 'session',
            data: withEnvelopeHistoryTime(envelope, createdAt),
          },
          meta: {
            sentFrom: 'cli',
          },
        },
      });

    }
  }

  return { found: true, ...pageLocalMessageRecords(mapped, limit, options.beforeCreatedAt) };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function normalizeMessageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.max(1, Math.min(MAX_MESSAGE_LIMIT, Math.floor(limit)));
}

function getClaudeProjectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(os.homedir(), '.claude'), 'projects');
}

function getCodexSessionsDir(): string {
  return join(process.env.CODEX_HOME || join(os.homedir(), '.codex'), 'sessions');
}

async function listLocalHistoryFiles(flavor: SyncLocalSessionsFlavor): Promise<LocalHistoryFile[]> {
  const lists = await Promise.all([
    flavor === 'all' || flavor === 'claude' ? listClaudeHistoryFiles() : Promise.resolve([]),
    flavor === 'all' || flavor === 'codex' ? listCodexHistoryFiles() : Promise.resolve([]),
  ]);
  return lists.flat().sort(compareHistoryFiles);
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
          flavor: 'claude',
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

async function listCodexHistoryFiles(): Promise<CodexHistoryFile[]> {
  const sessionsDir = getCodexSessionsDir();
  const files: CodexHistoryFile[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        return;
      }
      try {
        const stat = await fs.stat(entryPath);
        const sessionId = await resolveCodexSessionId(entryPath, entry.name);
        if (!sessionId) {
          return;
        }
        files.push({
          flavor: 'codex',
          sessionId,
          filePath: entryPath,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }));
  }

  await visit(sessionsDir);
  return files.sort(compareHistoryFiles);
}

async function resolveCodexSessionId(filePath: string, fileName: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const record = JSON.parse(trimmed) as { type?: unknown; payload?: { id?: unknown } };
      if (record.type === 'session_meta' && typeof record.payload?.id === 'string' && record.payload.id.length > 0) {
        return record.payload.id;
      }
    }
  } catch {
    // Fall back to rollout filename parsing below.
  }

  const match = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] ?? null;
}

async function readCodexSessionTitles(): Promise<Map<string, string>> {
  const indexPath = join(process.env.CODEX_HOME || join(os.homedir(), '.codex'), 'session_index.jsonl');
  let raw = '';
  try {
    raw = await fs.readFile(indexPath, 'utf8');
  } catch {
    return new Map();
  }

  const titles = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const record = JSON.parse(trimmed) as { id?: unknown; thread_name?: unknown };
      if (typeof record.id === 'string' && typeof record.thread_name === 'string') {
        const title = record.thread_name.trim();
        if (title.length > 0) {
          titles.set(record.id, title);
        }
      }
    } catch {
      // Keep scanning when one index row is malformed or partially written.
    }
  }

  return titles;
}

function compareHistoryFiles(a: LocalHistoryFile, b: LocalHistoryFile | CursorValue): number {
  if (a.mtimeMs !== b.mtimeMs) {
    return b.mtimeMs - a.mtimeMs;
  }
  return b.sessionId.localeCompare(a.sessionId);
}

async function readClaudeHistoryFile(file: ClaudeHistoryFile): Promise<{
  cwd: string | null;
  title: string | null;
  summary: string | null;
  updatedAt: number;
  currentModelCode?: string | null;
  hasConversationContent: boolean;
}> {
  let raw = '';
  try {
    raw = await fs.readFile(file.filePath, 'utf8');
  } catch {
    return { cwd: null, title: null, summary: null, updatedAt: file.mtimeMs, currentModelCode: null, hasConversationContent: false };
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

  return { cwd, title: summary, summary, updatedAt, currentModelCode: null, hasConversationContent };
}

async function readCodexHistoryFile(file: CodexHistoryFile, nativeTitle: string | null): Promise<{
  cwd: string | null;
  title: string | null;
  summary: string | null;
  updatedAt: number;
  currentModelCode?: string | null;
  hasConversationContent: boolean;
}> {
  const records = await readCodexHistoryRecords(file);
  let cwd: string | null = null;
  let title: string | null = nativeTitle;
  let currentModelCode: string | null = null;
  let updatedAt = file.mtimeMs;
  let hasConversationContent = false;

  for (const record of records) {
    const timestamp = parseRecordTimestamp(record.timestamp);

    const payload = isRecord(record.payload) ? record.payload : {};
    if (record.type === 'session_meta') {
      if (typeof payload.cwd === 'string' && payload.cwd.length > 0) {
        cwd = payload.cwd;
      }
      continue;
    }

    if (record.type === 'turn_context') {
      if (typeof payload.cwd === 'string' && payload.cwd.length > 0) {
        cwd = payload.cwd;
      }
      if (typeof payload.model === 'string' && payload.model.length > 0) {
        currentModelCode = payload.model;
      }
      continue;
    }

    if (record.type === 'event_msg') {
      const type = payload.type;
      if (type === 'user_message' && typeof payload.message === 'string' && payload.message.trim().length > 0) {
        hasConversationContent = true;
        if (timestamp !== null) {
          updatedAt = timestamp;
        }
      } else if (type === 'agent_message' && typeof payload.message === 'string' && payload.message.trim().length > 0) {
        hasConversationContent = true;
        if (timestamp !== null) {
          updatedAt = timestamp;
        }
      }
    }
  }

  return { cwd, title, summary: title, updatedAt, currentModelCode, hasConversationContent };
}

async function readClaudeHistoryRecords(file: ClaudeHistoryFile): Promise<RawJSONLines[]> {
  let raw = '';
  try {
    raw = await fs.readFile(file.filePath, 'utf8');
  } catch {
    return [];
  }

  const records: RawJSONLines[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed) as RawJSONLines);
    } catch {
      // Keep scanning when a single JSONL row is malformed or partially written.
    }
  }
  return records;
}

type CodexHistoryRecord = {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
};

async function readCodexHistoryRecords(file: CodexHistoryFile): Promise<CodexHistoryRecord[]> {
  let raw = '';
  try {
    raw = await fs.readFile(file.filePath, 'utf8');
  } catch {
    return [];
  }

  const records: CodexHistoryRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed) as CodexHistoryRecord);
    } catch {
      // Keep scanning when a single JSONL row is malformed or partially written.
    }
  }
  return records;
}

async function readCodexHistoryMessages(file: CodexHistoryFile, limit: number, beforeCreatedAt?: number | null): Promise<SyncLocalSessionMessagesResult> {
  const records = await readCodexHistoryRecords(file);
  const state: CodexTurnState = {
    currentTurnId: null,
    startedSubagents: new Set(),
    activeSubagents: new Set(),
    providerSubagentToSessionSubagent: new Map(),
  };
  const mapped: SyncLocalSessionMessagesResult['records'] = [];

  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload) {
      continue;
    }

    const timestamp = parseRecordTimestamp(record.timestamp) ?? Date.now();

    if (record.type === 'event_msg' && payload.type === 'user_message') {
      const text = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (text.length === 0) {
        continue;
      }
      const displayText = getImportedUserMessageDisplayText(text);
      const order = mapped.length;
      mapped.push({
        localId: `local-codex:${file.sessionId}:${timestamp}:${order}`,
        createdAt: timestamp,
        record: {
          role: 'user',
          content: {
            type: 'text',
            text,
          },
          meta: {
            sentFrom: 'cli',
            ...(displayText !== text ? { displayText } : {}),
          },
        },
      });
    } else {
      const event = codexHistoryRecordToMcpEvent(record.type, payload);
      if (!event) {
        continue;
      }

      // The stored payload uses the same event names as the live Codex app-server
      // integration, so reuse that mapper to keep imported history consistent.
      const result = mapCodexMcpMessageToSessionEnvelopes(event, state);
      state.currentTurnId = result.currentTurnId;
      state.startedSubagents = result.startedSubagents;
      state.activeSubagents = result.activeSubagents;
      state.providerSubagentToSessionSubagent = result.providerSubagentToSessionSubagent;

      for (let i = 0; i < result.envelopes.length; i++) {
        const order = mapped.length;
        mapped.push({
          localId: `local-codex:${file.sessionId}:${timestamp}:${order}:${i}`,
          createdAt: timestamp,
          record: {
            role: 'session',
            content: {
              type: 'session',
              data: withEnvelopeHistoryTime(result.envelopes[i], timestamp),
            },
            meta: {
              sentFrom: 'cli',
            },
          },
        });
      }
    }

  }

  return { found: true, ...pageLocalMessageRecords(mapped, limit, beforeCreatedAt) };
}

function codexHistoryRecordToMcpEvent(recordType: unknown, payload: Record<string, unknown>): Record<string, unknown> | null {
  if (recordType === 'event_msg') {
    return payload;
  }

  if (recordType !== 'response_item') {
    return null;
  }

  if (payload.type === 'function_call') {
    return {
      ...parseCodexArguments(payload.arguments),
      type: 'exec_command_begin',
      call_id: payload.call_id,
      name: payload.name,
      command: getCodexFunctionCommand(payload),
    };
  }

  if (payload.type === 'function_call_output') {
    return {
      type: 'exec_command_end',
      call_id: payload.call_id,
      output: typeof payload.output === 'string' ? payload.output : undefined,
      status: payload.status,
    };
  }

  if (payload.type === 'custom_tool_call') {
    return {
      type: payload.name === 'apply_patch' ? 'patch_apply_begin' : 'exec_command_begin',
      call_id: payload.call_id,
      name: payload.name,
      command: payload.name,
      changes: payload.name === 'apply_patch' ? { patch: true } : undefined,
      input: payload.input,
      status: payload.status,
    };
  }

  if (payload.type === 'custom_tool_call_output') {
    return {
      type: payload.name === 'apply_patch' ? 'patch_apply_end' : 'exec_command_end',
      call_id: payload.call_id,
      name: payload.name,
      output: typeof payload.output === 'string' ? payload.output : undefined,
      success: payload.status !== 'failed',
      status: payload.status,
    };
  }

  return null;
}

function parseCodexArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getCodexFunctionCommand(payload: Record<string, unknown>): unknown {
  const args = parseCodexArguments(payload.arguments);
  if (typeof args.cmd === 'string') {
    return args.cmd;
  }
  if (typeof args.command === 'string' || Array.isArray(args.command)) {
    return args.command;
  }
  return payload.name;
}

function withEnvelopeHistoryTime<T extends { time: number }>(envelope: T, time: number): T {
  return {
    ...envelope,
    time,
  };
}

function pageLocalMessageRecords(
  records: SyncLocalSessionMessagesResult['records'],
  limit: number,
  beforeCreatedAt?: number | null,
): Pick<SyncLocalSessionMessagesResult, 'records' | 'hasMore'> {
  const ordered = [...records].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }
    const aOrder = getLocalMessageOrder(a.localId);
    const bOrder = getLocalMessageOrder(b.localId);
    if (aOrder !== bOrder) {
      return bOrder - aOrder;
    }
    return b.localId.localeCompare(a.localId);
  });
  const filtered = typeof beforeCreatedAt === 'number' && Number.isFinite(beforeCreatedAt)
    ? ordered.filter((record) => record.createdAt < beforeCreatedAt)
    : ordered;
  return {
    records: filtered.slice(0, limit),
    hasMore: filtered.length > limit,
  };
}

function getLocalMessageOrder(localId: string): number {
  const match = localId.match(/^local-(?:codex|claude):[^:]+:\d{10,}:(\d+)/);
  if (!match) {
    return 0;
  }
  const order = Number(match[1]);
  return Number.isFinite(order) ? order : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function parseRecordTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function getImportedUserMessageDisplayText(text: string): string {
  return stripTrailingChangeTitleInstruction(stripLeadingHappySystemPrompt(text)).trim();
}

function stripTrailingChangeTitleInstruction(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith(CHANGE_TITLE_INSTRUCTION)) {
    return trimmed;
  }
  return trimmed.slice(0, -CHANGE_TITLE_INSTRUCTION.length).trim();
}

function stripLeadingHappySystemPrompt(text: string): string {
  const marker = '# Options';
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(marker)) {
    return text;
  }

  const instructionIndex = trimmed.indexOf(CHANGE_TITLE_INSTRUCTION);
  if (instructionIndex === -1) {
    return text;
  }

  const beforeInstruction = trimmed.slice(0, instructionIndex).trimEnd();
  const separatorIndex = beforeInstruction.lastIndexOf('\n\n');
  if (separatorIndex === -1) {
    return text;
  }

  return `${beforeInstruction.slice(separatorIndex + 2).trim()}\n\n${trimmed.slice(instructionIndex).trimStart()}`;
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
