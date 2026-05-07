export type VoiceProviderId = 'elevenlabs' | 'dashscope-asr';

export interface VoiceSessionConfig {
    sessionId: string;
    initialContext?: string;
    systemPrompt?: string;
    firstMessage?: string;
    conversationToken?: string;
    agentId?: string;
    userId?: string;
    onFinalTranscript?: (text: string) => void | Promise<void>;
}

export interface VoiceSession {
    id: VoiceProviderId;
    label: string;
    mode: 'conversation' | 'speech-recognition';
    startSession(config: VoiceSessionConfig): Promise<string | null>;
    endSession(): Promise<void>;
    sendTextMessage(message: string): void;
    sendContextualUpdate(update: string): void;
}

export type ConversationStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ConversationMode = 'idle' | 'agent-speaking' | 'user-speaking';
