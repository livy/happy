import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '@/sync/storage';
import { registerVoiceProvider } from './voiceProviders';
import type { VoiceSession, VoiceSessionConfig } from './types';

type TranscriptCallback = NonNullable<VoiceSessionConfig['onFinalTranscript']>;

type DashScopeAsrResponse = {
    choices?: Array<{ message?: { content?: unknown } }>;
    output?: {
        text?: string;
        transcription?: string;
        sentence?: { text?: string };
        sentences?: Array<{ text?: string }>;
        choices?: Array<{ message?: { content?: unknown } }>;
    };
    text?: string;
    result?: { text?: string };
    message?: string;
};

const DASHSCOPE_COMPATIBLE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DASHSCOPE_ASR_MODEL = 'qwen3-asr-flash';

let activeController: DashScopeAsrController | null = null;

function getDashScopeApiKey(): string | null {
    return storage.getState().settings.voiceDashScopeApiKey?.trim() || null;
}

function getAudioMimeType(uri: string | null): string {
    const lower = uri?.toLowerCase() ?? '';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.webm')) return 'audio/webm';
    if (lower.endsWith('.3gp')) return 'audio/3gpp';
    return 'audio/mp4';
}

function extractTextFromContent(content: unknown): string | null {
    if (typeof content === 'string') {
        return content.trim() || null;
    }
    if (Array.isArray(content)) {
        const text = content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'text' in part) {
                    return String((part as { text?: unknown }).text ?? '');
                }
                return '';
            })
            .join('')
            .trim();
        return text || null;
    }
    return null;
}

function extractTranscript(response: DashScopeAsrResponse): string | null {
    const candidates = [
        response.output?.text,
        response.output?.transcription,
        response.output?.sentence?.text,
        response.output?.sentences?.map((sentence) => sentence.text).filter(Boolean).join(''),
        extractTextFromContent(response.output?.choices?.[0]?.message?.content),
        extractTextFromContent(response.choices?.[0]?.message?.content),
        response.result?.text,
        response.text,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return null;
}

class DashScopeAsrController {
    private abortController: AbortController | null = null;
    private callback: TranscriptCallback | null = null;
    private sessionId: string | null = null;

    constructor(private readonly recorder: ReturnType<typeof useAudioRecorder>) {}

    async startSession(config: VoiceSessionConfig): Promise<string | null> {
        const apiKey = getDashScopeApiKey();
        if (!apiKey) {
            throw new Error('DashScope API key is not configured');
        }

        this.callback = config.onFinalTranscript ?? null;
        this.sessionId = config.sessionId;
        storage.getState().setRealtimeStatus('connecting');
        storage.getState().setRealtimeMode('idle');

        await this.recorder.prepareToRecordAsync();
        this.recorder.record();

        storage.getState().setRealtimeStatus('connected');
        storage.getState().setRealtimeMode('user-speaking', true);
        return `dashscope-asr-${Date.now()}`;
    }

    async endSession(): Promise<void> {
        const apiKey = getDashScopeApiKey();
        const callback = this.callback;
        this.callback = null;
        this.sessionId = null;

        try {
            if (this.recorder.isRecording) {
                await this.recorder.stop();
            }
            storage.getState().setRealtimeMode('idle', true);

            const uri = this.recorder.uri;
            if (apiKey && uri && callback) {
                storage.getState().setRealtimeStatus('connecting');
                const transcript = await this.transcribe(uri, apiKey);
                if (transcript) {
                    await callback(transcript);
                }
            }
        } finally {
            this.abortController = null;
            storage.getState().setRealtimeStatus('disconnected');
            storage.getState().setRealtimeMode('idle', true);
        }
    }

    sendTextMessage(_message: string): void {}

    sendContextualUpdate(_update: string): void {}

    cancel(): void {
        this.abortController?.abort();
    }

    private async transcribe(uri: string, apiKey: string): Promise<string | null> {
        const base64Audio = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
        });
        const mimeType = getAudioMimeType(uri);
        const dataUri = `data:${mimeType};base64,${base64Audio}`;
        this.abortController = new AbortController();

        const response = await fetch(DASHSCOPE_COMPATIBLE_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            signal: this.abortController.signal,
            body: JSON.stringify({
                model: DASHSCOPE_ASR_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Transcribe this audio exactly. Return only the transcript.' },
                            {
                                type: 'input_audio',
                                input_audio: {
                                    data: dataUri,
                                },
                            },
                        ],
                    },
                ],
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`DashScope ASR failed: ${response.status}${body ? ` ${body}` : ''}`);
        }

        const json = await response.json() as DashScopeAsrResponse;
        return extractTranscript(json);
    }
}

class DashScopeAsrVoiceSessionImpl implements VoiceSession {
    id = 'dashscope-asr' as const;
    label = '阿里百炼语音识别';
    mode = 'speech-recognition' as const;

    async startSession(config: VoiceSessionConfig): Promise<string | null> {
        if (!activeController) {
            throw new Error('DashScope ASR session not initialized');
        }
        return activeController.startSession(config);
    }

    async endSession(): Promise<void> {
        if (!activeController) {
            storage.getState().setRealtimeStatus('disconnected');
            return;
        }
        await activeController.endSession();
    }

    sendTextMessage(message: string): void {
        activeController?.sendTextMessage(message);
    }

    sendContextualUpdate(update: string): void {
        activeController?.sendContextualUpdate(update);
    }
}

export const DashScopeAsrVoiceSession: React.FC = () => {
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const recorderState = useAudioRecorderState(recorder, 250);
    const hasRegistered = useRef(false);

    useEffect(() => {
        activeController = new DashScopeAsrController(recorder);
        if (!hasRegistered.current) {
            registerVoiceProvider(new DashScopeAsrVoiceSessionImpl());
            hasRegistered.current = true;
        }

        return () => {
            activeController?.cancel();
            activeController = null;
        };
    }, [recorder]);

    useEffect(() => {
        if (storage.getState().settings.voiceInputProvider !== 'dashscope-asr') return;
        if (recorderState.isRecording) {
            storage.getState().setRealtimeMode('user-speaking', true);
        }
    }, [recorderState.isRecording]);

    if (Platform.OS === 'web') {
        return null;
    }

    return null;
};
