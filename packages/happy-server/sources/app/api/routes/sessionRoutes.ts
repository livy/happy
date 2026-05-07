import { eventRouter, buildNewSessionUpdate, buildSessionActivityEphemeral } from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { allocateUserSeq } from "@/storage/seq";
import { sessionDelete } from "@/app/session/sessionDelete";

const latestMessageSelect = {
    orderBy: { seq: 'desc' as const },
    take: 1,
    select: {
        createdAt: true,
        localId: true
    }
};

function getLocalImportMessageAt(localId: string | null): number | null {
    if (!localId) {
        return null;
    }
    const match = localId.match(/^local-(?:codex|claude):[^:]+:(\d{10,}):/);
    if (!match) {
        return null;
    }
    const timestamp = Number(match[1]);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getLastMessageAt(session: { messages?: Array<{ createdAt: Date; localId: string | null }> }): number | null {
    const message = session.messages?.[0];
    if (!message) {
        return null;
    }
    const createdAt = message.createdAt.getTime();
    const localImportAt = getLocalImportMessageAt(message.localId);
    return localImportAt !== null ? Math.min(createdAt, localImportAt) : createdAt;
}

export function sessionRoutes(app: Fastify) {

    // Sessions API
    app.get('/v1/sessions', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const sessions = await db.session.findMany({
            where: { accountId: userId },
            orderBy: { updatedAt: 'desc' },
            take: 150,
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                dataEncryptionKey: true,
                active: true,
                lastActiveAt: true,
                messages: latestMessageSelect
            }
        });

        return reply.send({
            sessions: sessions.map((v) => {
                const sessionUpdatedAt = v.updatedAt.getTime();

                return {
                    id: v.id,
                    seq: v.seq,
                    createdAt: v.createdAt.getTime(),
                    updatedAt: sessionUpdatedAt,
                    lastMessageAt: getLastMessageAt(v),
                    active: v.active,
                    activeAt: v.lastActiveAt.getTime(),
                    metadata: v.metadata,
                    metadataVersion: v.metadataVersion,
                    agentState: v.agentState,
                    agentStateVersion: v.agentStateVersion,
                    dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
                    lastMessage: null
                };
            })
        });
    });

    // V2 Sessions API - Active sessions only
    app.get('/v2/sessions/active', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(500).default(150)
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit || 150;

        const sessions = await db.session.findMany({
            where: {
                accountId: userId,
                active: true,
                lastActiveAt: { gt: new Date(Date.now() - 1000 * 60 * 15) /* 15 minutes */ }
            },
            orderBy: { lastActiveAt: 'desc' },
            take: limit,
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                dataEncryptionKey: true,
                active: true,
                lastActiveAt: true,
                messages: latestMessageSelect,
            }
        });

        return reply.send({
            sessions: sessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                lastMessageAt: getLastMessageAt(v),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
                dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
            }))
        });
    });

    // V2 Sessions API - Cursor-based pagination with change tracking
    app.get('/v2/sessions', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                cursor: z.string().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(50),
                changedSince: z.coerce.number().int().positive().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { cursor, limit = 50, changedSince } = request.query || {};

        // Decode cursor. v2 cursors are based on (updatedAt desc, id desc)
        // so pagination follows "most recently updated sessions" order.
        let cursorSessionId: string | undefined;
        let cursorUpdatedAt: Date | undefined;
        let legacyCursor = false;
        if (cursor) {
            const v2Match = cursor.match(/^cursor_v2_(\d+)_(.+)$/);
            if (v2Match) {
                cursorUpdatedAt = new Date(Number(v2Match[1]));
                cursorSessionId = v2Match[2];
            } else if (cursor.startsWith('cursor_v1_')) {
                // Backward compatibility for older clients. This keeps the
                // original id-desc pagination semantics for v1 cursors.
                legacyCursor = true;
                cursorSessionId = cursor.substring(10);
            } else {
                return reply.code(400).send({ error: 'Invalid cursor format' });
            }
        }

        // Build where clause
        const where: Prisma.SessionWhereInput = { accountId: userId };

        // Add changedSince filter (just a filter, doesn't affect pagination)
        if (changedSince) {
            where.updatedAt = {
                gt: new Date(changedSince)
            };
        }

        // Add cursor pagination in the same order as the query:
        // updatedAt desc, id desc.
        if (cursorSessionId && cursorUpdatedAt) {
            where.OR = [
                { updatedAt: { lt: cursorUpdatedAt } },
                { updatedAt: cursorUpdatedAt, id: { lt: cursorSessionId } }
            ];
        } else if (cursorSessionId) {
            where.id = {
                lt: cursorSessionId
            };
        }

        const orderBy = legacyCursor
            ? { id: 'desc' as const }
            : [
                { updatedAt: 'desc' as const },
                { id: 'desc' as const }
            ];

        const sessions = await db.session.findMany({
            where,
            orderBy,
            take: limit + 1, // Fetch one extra to determine if there are more
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                dataEncryptionKey: true,
                active: true,
                lastActiveAt: true,
                messages: latestMessageSelect,
            }
        });

        // Check if there are more results
        const hasNext = sessions.length > limit;
        const resultSessions = hasNext ? sessions.slice(0, limit) : sessions;

        // Generate next cursor - simple ID-based cursor
        let nextCursor: string | null = null;
        if (hasNext && resultSessions.length > 0) {
            const lastSession = resultSessions[resultSessions.length - 1];
            nextCursor = `cursor_v2_${lastSession.updatedAt.getTime()}_${lastSession.id}`;
        }

        return reply.send({
            sessions: resultSessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                lastMessageAt: getLastMessageAt(v),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
                dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
            })),
            nextCursor,
            hasNext
        });
    });

    // Create or load session by tag
    app.post('/v1/sessions', {
        schema: {
            body: z.object({
                tag: z.string(),
                metadata: z.string(),
                agentState: z.string().nullish(),
                dataEncryptionKey: z.string().nullish(),
                active: z.boolean().optional(),
                activeAt: z.number().optional(),
                createdAt: z.number().optional(),
                updatedAt: z.number().optional()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { tag, metadata, agentState, dataEncryptionKey, active, activeAt, createdAt, updatedAt } = request.body;

        const session = await db.session.findFirst({
            where: {
                accountId: userId,
                tag: tag
            }
        });
        if (session) {
            log({ module: 'session-create', sessionId: session.id, userId, tag }, `Found existing session: ${session.id} for tag ${tag}`);
            const shouldUpdateActivity =
                active !== undefined
                || activeAt !== undefined
                || updatedAt !== undefined;
            const resolvedSession = shouldUpdateActivity
                ? await db.session.update({
                    where: { id: session.id },
                    data: {
                        ...(active !== undefined ? { active } : {}),
                        ...(activeAt !== undefined ? { lastActiveAt: new Date(activeAt) } : {}),
                        ...(updatedAt !== undefined ? { updatedAt: new Date(updatedAt) } : {})
                    }
                })
                : session;
            return reply.send({
                session: {
                    id: resolvedSession.id,
                    seq: resolvedSession.seq,
                    metadata: resolvedSession.metadata,
                    metadataVersion: resolvedSession.metadataVersion,
                    agentState: resolvedSession.agentState,
                    agentStateVersion: resolvedSession.agentStateVersion,
                    dataEncryptionKey: resolvedSession.dataEncryptionKey ? Buffer.from(resolvedSession.dataEncryptionKey).toString('base64') : null,
                    active: resolvedSession.active,
                    activeAt: resolvedSession.lastActiveAt.getTime(),
                    createdAt: resolvedSession.createdAt.getTime(),
                    updatedAt: resolvedSession.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        } else {

            // Resolve seq
            const updSeq = await allocateUserSeq(userId);

            // Create session
            log({ module: 'session-create', userId, tag }, `Creating new session for user ${userId} with tag ${tag}`);
            const session = await db.session.create({
                data: {
                    accountId: userId,
                    tag: tag,
                    metadata: metadata,
                    agentState: agentState ?? null,
                    dataEncryptionKey: dataEncryptionKey ? new Uint8Array(Buffer.from(dataEncryptionKey, 'base64')) : undefined,
                    active: active ?? true,
                    lastActiveAt: activeAt ? new Date(activeAt) : undefined,
                    createdAt: createdAt ? new Date(createdAt) : undefined,
                    updatedAt: updatedAt ? new Date(updatedAt) : undefined
                }
            });
            log({ module: 'session-create', sessionId: session.id, userId }, `Session created: ${session.id}`);

            // Emit new session update
            const updatePayload = buildNewSessionUpdate(session, updSeq, randomKeyNaked(12));
            log({
                module: 'session-create',
                userId,
                sessionId: session.id,
                updateType: 'new-session',
                updatePayload: JSON.stringify(updatePayload)
            }, `Emitting new-session update to user-scoped connections`);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            return reply.send({
                session: {
                    id: session.id,
                    seq: session.seq,
                    metadata: session.metadata,
                    metadataVersion: session.metadataVersion,
                    agentState: session.agentState,
                    agentStateVersion: session.agentStateVersion,
                    dataEncryptionKey: session.dataEncryptionKey ? Buffer.from(session.dataEncryptionKey).toString('base64') : null,
                    active: session.active,
                    activeAt: session.lastActiveAt.getTime(),
                    createdAt: session.createdAt.getTime(),
                    updatedAt: session.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        }
    });

    app.get('/v1/sessions/:sessionId/messages', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        // Verify session belongs to user
        const session = await db.session.findFirst({
            where: {
                id: sessionId,
                accountId: userId
            }
        });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const messages = await db.sessionMessage.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'desc' },
            take: 150,
            select: {
                id: true,
                seq: true,
                localId: true,
                content: true,
                createdAt: true,
                updatedAt: true
            }
        });

        return reply.send({
            messages: messages.map((v) => ({
                id: v.id,
                seq: v.seq,
                content: v.content,
                localId: v.localId,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime()
            }))
        });
    });

    // Archive session (force deactivate)
    app.post('/v1/sessions/:sessionId/archive', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const result = await db.session.updateMany({
            where: { id: sessionId, accountId: userId },
            data: { active: false, lastActiveAt: new Date() }
        });

        if (result.count === 0) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        // Notify all clients about the session deactivation
        const sessionActivity = buildSessionActivityEphemeral(sessionId, false, Date.now(), false);
        eventRouter.emitEphemeral({
            userId,
            payload: sessionActivity,
            recipientFilter: { type: 'user-scoped-only' }
        });

        return reply.send({ success: true });
    });

    // Delete session
    app.delete('/v1/sessions/:sessionId', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const deleted = await sessionDelete({ uid: userId }, sessionId);

        if (!deleted) {
            return reply.code(404).send({ error: 'Session not found or not owned by user' });
        }

        return reply.send({ success: true });
    });
}
