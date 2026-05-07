import type { VoiceProviderId, VoiceSession } from './types';

const voiceSessions = new Map<VoiceProviderId, VoiceSession>();

export const DEFAULT_VOICE_PROVIDER_ID: VoiceProviderId = 'elevenlabs';

export function registerVoiceProvider(session: VoiceSession) {
    voiceSessions.set(session.id, session);
}

export function getVoiceProvider(id: VoiceProviderId): VoiceSession | null {
    return voiceSessions.get(id) ?? null;
}

export function getRegisteredVoiceProviders(): VoiceSession[] {
    return Array.from(voiceSessions.values());
}

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
    return value === 'elevenlabs' || value === 'dashscope-asr';
}
