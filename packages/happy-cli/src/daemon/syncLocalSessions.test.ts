import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import { syncLocalSessionMessages } from './syncLocalSessions';

const tempDirs: string[] = [];

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  delete process.env.CODEX_HOME;
});

describe('syncLocalSessionMessages', () => {
  it('keeps imported Codex user display text aligned with app-sent messages', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
    tempDirs.push(codexHome);
    process.env.CODEX_HOME = codexHome;

    const sessionDir = join(codexHome, 'sessions', '2026', '05', '01');
    await mkdir(sessionDir, { recursive: true });

    const nativeSessionId = '11111111-1111-4111-8111-111111111111';
    const userText = '生成的文件，作为一个可以点击的超链接';
    const storedPrompt = `${userText}\n\n${CHANGE_TITLE_INSTRUCTION}`;
    await writeFile(join(sessionDir, `${nativeSessionId}.jsonl`), [
      JSON.stringify({
        timestamp: '2026-05-01T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: nativeSessionId, cwd: '/tmp/project' },
      }),
      JSON.stringify({
        timestamp: '2026-05-01T00:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: storedPrompt },
      }),
    ].join('\n'));

    const result = await syncLocalSessionMessages({
      nativeSessionId,
      flavor: 'codex',
    });

    expect(result.found).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].record).toMatchObject({
      role: 'user',
      content: {
        type: 'text',
        text: storedPrompt,
      },
      meta: {
        sentFrom: 'cli',
        displayText: userText,
      },
    });
  });

  it('hides Happy system prompt text from imported user display text', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
    tempDirs.push(codexHome);
    process.env.CODEX_HOME = codexHome;

    const sessionDir = join(codexHome, 'sessions', '2026', '05', '01');
    await mkdir(sessionDir, { recursive: true });

    const nativeSessionId = '22222222-2222-4222-8222-222222222222';
    const userText = '继续处理下载链接';
    const storedPrompt = [
      '# Options',
      '',
      'Internal Happy UI option instructions.',
      '',
      userText,
      '',
      CHANGE_TITLE_INSTRUCTION,
    ].join('\n');

    await writeFile(join(sessionDir, `${nativeSessionId}.jsonl`), [
      JSON.stringify({
        timestamp: '2026-05-01T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: nativeSessionId, cwd: '/tmp/project' },
      }),
      JSON.stringify({
        timestamp: '2026-05-01T00:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: storedPrompt },
      }),
    ].join('\n'));

    const result = await syncLocalSessionMessages({
      nativeSessionId,
      flavor: 'codex',
    });

    expect(result.records[0].record).toMatchObject({
      meta: {
        displayText: userText,
      },
    });
  });
});
