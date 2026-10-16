import type { Server, ServerWebSocket } from "bun";
import { prisma } from "db/prisma";
import { authenticateRequest, extractSubprotocol } from "./auth/authUpgrade";
import { wsBroadcaster } from "./services/broadcaster";
import
{
    type WebSocketData,
    type ClientMessage,
    formatBoardTopic,
    cleanBoardId
} from "./types/events";

export type BoardAccessChecker = (userId: string, boardId: string) => Promise<boolean> | boolean;

// 1. User -> Set of Org IDs they belong to (O(1) access check)
export const userOrgMembership = new Map<string, Set<string>>();

// 2. Org ID -> Set of User IDs currently connected (reverse index for fast O(1) org-scoped lookups)
export const orgMembers = new Map<string, Set<string>>();

// 3. Board ID -> Org ID mapping (normalized with cleanBoardId; eliminates prisma.boards.findMany queries during eviction)
export const boardOrgMap = new Map<string, string>();

export function recordUserMembership(userId: string, orgId: string, boardId?: string): void
{
    const cleanUid = userId?.trim();
    const cleanOid = orgId?.trim();
    if (!cleanUid || !cleanOid) return;

    let orgSet = userOrgMembership.get(cleanUid);
    if (!orgSet)
    {
        orgSet = new Set();
        userOrgMembership.set(cleanUid, orgSet);
    }
    orgSet.add(cleanOid);

    let userSet = orgMembers.get(cleanOid);
    if (!userSet)
    {
        userSet = new Set();
        orgMembers.set(cleanOid, userSet);
    }
    userSet.add(cleanUid);

    if (boardId)
    {
        const cleanBid = cleanBoardId(boardId);
        if (cleanBid)
        {
            boardOrgMap.set(cleanBid, cleanOid);
        }
    }
}

export function revokeUserMembership(userId: string, orgId: string): void
{
    const cleanUid = userId?.trim();
    const cleanOid = orgId?.trim();
    if (!cleanUid || !cleanOid) return;

    const orgSet = userOrgMembership.get(cleanUid);
    if (orgSet)
    {
        orgSet.delete(cleanOid);
        if (orgSet.size === 0)
        {
            userOrgMembership.delete(cleanUid);
        }
    }

    const userSet = orgMembers.get(cleanOid);
    if (userSet)
    {
        userSet.delete(cleanUid);
        if (userSet.size === 0)
        {
            orgMembers.delete(cleanOid);
        }
    }
}

export function cleanupUserMembership(userId: string): void
{
    const cleanUid = userId?.trim();
    if (!cleanUid) return;

    const orgSet = userOrgMembership.get(cleanUid);
    if (orgSet)
    {
        for (const orgId of orgSet)
        {
            const userSet = orgMembers.get(orgId);
            if (userSet)
            {
                userSet.delete(cleanUid);
                if (userSet.size === 0)
                {
                    orgMembers.delete(orgId);
                }
            }
        }
        userOrgMembership.delete(cleanUid);
    }
}

export function resetMembershipRegistries(): void
{
    userOrgMembership.clear();
    orgMembers.clear();
    boardOrgMap.clear();
}

export async function defaultCheckBoardAccess(userId: string, boardId: string): Promise<boolean>
{
    const rawId = cleanBoardId(boardId);
    if (!rawId || !userId) return false;
    try
    {
        const board = await prisma.boards.findUnique({
            where: { id: rawId },
            select: {
                orgId: true,
                org: {
                    select: {
                        members: {
                            where: {
                                userId,
                                accepted: true
                            },
                            select: { id: true }
                        }
                    }
                }
            }
        });
        const hasAccess = Boolean(board && board.org && board.org.members.length > 0);
        if (hasAccess && board?.orgId)
        {
            recordUserMembership(userId, board.orgId, rawId);
        }
        return hasAccess;
    } catch
    {
        return false;
    }
}

let activeBoardAccessChecker: BoardAccessChecker = defaultCheckBoardAccess;

export function setBoardAccessChecker(checker: BoardAccessChecker): void
{
    activeBoardAccessChecker = checker;
}

export function resetBoardAccessChecker(): void
{
    activeBoardAccessChecker = defaultCheckBoardAccess;
}

export interface WebSocketServerOptions
{
    port?: number;
    jwtSecret?: string;
    hostname?: string;
    checkAccess?: BoardAccessChecker;
    idleTimeout?: number;
    sendPings?: boolean;
    heartbeatInterval?: number;
}

// Layer 2 In-Memory Connection Registry: maps authenticated userId to active sockets
export const userSocketRegistry = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

export async function evictUserSockets(
    server: Pick<Server<WebSocketData>, "publish"> | null | undefined,
    body: { userId: string; orgId?: string; boardIds?: string[]; reason?: string }
): Promise<number>
{
    if (!body?.userId || typeof body.userId !== "string")
    {
        return 0;
    }
    const cleanUid = body.userId.trim();
    if (!cleanUid)
    {
        return 0;
    }
    const sockets = userSocketRegistry.get(cleanUid);
    let evictedCount = 0;
    if (sockets && sockets.size > 0)
    {
        const hasOrgScope = Boolean(body.orgId || (body.boardIds && body.boardIds.length > 0));

        if (hasOrgScope)
        {
            if (body.orgId)
            {
                revokeUserMembership(cleanUid, body.orgId);
            }

            let targetBoardIds = Array.isArray(body.boardIds) ? [...body.boardIds] : [];
            const targetTopics = new Set(targetBoardIds.map(formatBoardTopic).filter(Boolean));

            // Also match any subscription whose boardOrgMap maps to body.orgId
            if (body.orgId)
            {
                for (const ws of sockets)
                {
                    if (!ws?.data?.subscriptions) continue;
                    for (const topic of ws.data.subscriptions)
                    {
                        const bId = cleanBoardId(topic);
                        if (bId && boardOrgMap.get(bId) === body.orgId)
                        {
                            targetTopics.add(formatBoardTopic(bId));
                        }
                    }
                }

                // If targetTopics is still empty, fallback to DB query to find boards
                if (targetTopics.size === 0)
                {
                    try
                    {
                        const boards = await prisma.boards.findMany({
                            where: { orgId: body.orgId },
                            select: { id: true }
                        });
                        for (const b of boards)
                        {
                            boardOrgMap.set(b.id, body.orgId);
                            targetTopics.add(formatBoardTopic(b.id));
                        }
                    } catch { }
                }
            }

            const socketsToRemove: ServerWebSocket<WebSocketData>[] = [];

            for (const ws of sockets)
            {
                if (!ws?.data?.subscriptions) continue;
                let matchedAny = false;
                for (const topic of Array.from(ws.data.subscriptions))
                {
                    if (targetTopics.has(topic))
                    {
                        matchedAny = true;
                        const boardId = cleanBoardId(topic) || topic;

                        try
                        {
                            if (server && typeof server.publish === "function")
                            {
                                server.publish(topic, JSON.stringify({
                                    type: "user:left",
                                    payload: {
                                        userId: ws.data.userId,
                                        name: ws.data.name || ws.data.email || ws.data.userId,
                                        email: ws.data.email,
                                        boardId
                                    },
                                    timestamp: Date.now()
                                }));
                            }
                        } catch { }

                        try
                        {
                            ws.send(JSON.stringify({
                                type: "board:evicted",
                                boardId,
                                reason: body.reason || "FORBIDDEN_REVOKED: Organization membership terminated"
                            }));
                        } catch { }

                        try { ws.unsubscribe(topic); } catch { }
                        ws.data.subscriptions.delete(topic);
                    }
                }

                if (matchedAny)
                {
                    evictedCount++;
                    // Only terminate the socket if it no longer has active subscriptions to any other boards
                    if (ws.data.subscriptions.size === 0)
                    {
                        try
                        {
                            ws.close(4003, body.reason || "FORBIDDEN_REVOKED: Organization membership terminated");
                        } catch { }
                        socketsToRemove.push(ws);
                    }
                }
            }

            for (const ws of socketsToRemove)
            {
                sockets.delete(ws);
            }
            if (sockets.size === 0)
            {
                userSocketRegistry.delete(cleanUid);
                cleanupUserMembership(cleanUid);
            }
        } else
        {
            // Global user eviction (no orgId/boardIds specified) - terminate all sockets
            evictedCount = sockets.size;
            for (const ws of sockets)
            {
                if (!ws?.data?.subscriptions) continue;
                for (const topic of ws.data.subscriptions)
                {
                    try
                    {
                        if (server && typeof server.publish === "function")
                        {
                            server.publish(topic, JSON.stringify({
                                type: "user:left",
                                payload: {
                                    userId: ws.data.userId,
                                    name: ws.data.name || ws.data.email || ws.data.userId,
                                    email: ws.data.email,
                                    boardId: cleanBoardId(topic) || topic
                                },
                                timestamp: Date.now()
                            }));
                        }
                    } catch { }
                    try { ws.unsubscribe(topic); } catch { }
                }
                ws.data.subscriptions.clear();
                try { ws.close(4003, body.reason || "FORBIDDEN_REVOKED: User session terminated"); } catch { }
            }
            userSocketRegistry.delete(cleanUid);
            cleanupUserMembership(cleanUid);
        }
    }
    return evictedCount;
}

export function handleUpgradeRequest(
    req: Request,
    server: Pick<Server<WebSocketData>, "upgrade" | "publish" | "port">,
    jwtSecret: string
): Promise<Response | undefined> | Response | undefined
{
    const url = new URL(req.url);

    // 1. Internal broadcast endpoint for inter-process communication
    if (req.method === "POST" && url.pathname === "/internal/broadcast")
    {
        return (async () =>
        {
            try
            {
                // Internal secret protection if secret is configured (decoupled with fallback)
                const expectedSecret = process.env.INTERNAL_BROADCAST_SECRET || jwtSecret;
                const internalSecret = req.headers.get("x-internal-secret");
                if (expectedSecret && internalSecret !== expectedSecret)
                {
                    return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                const body = await req.json() as { boardId?: string; event?: unknown };
                if (!body || typeof body !== "object" || Array.isArray(body))
                {
                    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                if (!body.boardId || typeof body.boardId !== "string" || !body.boardId.trim() || !body.event)
                {
                    return new Response(JSON.stringify({ error: "Missing boardId or event" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const topic = formatBoardTopic(body.boardId);
                if (!topic)
                {
                    return new Response(JSON.stringify({ error: "Invalid boardId" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const payloadStr = typeof body.event === "string" ? body.event : JSON.stringify(body.event);

                // Publish once to the canonical board topic
                server.publish(topic, payloadStr);

                // Also notify local listeners attached to the singleton
                wsBroadcaster.emit("broadcast", { boardId: body.boardId, topic, event: body.event, raw: payloadStr });
                wsBroadcaster.emit(`board:${body.boardId}`, body.event);
                if (topic !== body.boardId)
                {
                    wsBroadcaster.emit(`board:${topic}`, body.event);
                }

                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            } catch
            {
                return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
        })();
    }

    // 1b. Internal administrative endpoint to forcibly evict a user's active sockets
    if (req.method === "POST" && url.pathname === "/internal/evict-user")
    {
        return (async () =>
        {
            try
            {
                const expectedSecret = process.env.INTERNAL_BROADCAST_SECRET || jwtSecret;
                const internalSecret = req.headers.get("x-internal-secret");
                if (expectedSecret && internalSecret !== expectedSecret)
                {
                    return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const body = await req.json() as {
                    userId?: string;
                    orgId?: string;
                    boardIds?: string[];
                    reason?: string;
                };
                if (!body?.userId || typeof body.userId !== "string")
                {
                    return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const evictedCount = await evictUserSockets(server, body as any);
                return new Response(JSON.stringify({ success: true, evictedCount }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            } catch
            {
                return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
        })();
    }

    // 2. Health check route
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health"))
    {
        return new Response(JSON.stringify({
            status: "ok",
            service: "websockets",
            port: server.port
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    }

    // 3. Intercept WebSocket Upgrade Handshake & Authenticate
    const user = authenticateRequest(req, jwtSecret);
    if (!user)
    {
        // Reject unauthenticated users at the HTTP handshake level to save resources
        return new Response("Unauthorized", { status: 401 });
    }

    // 4. Upgrade HTTP request to native WebSocket connection
    const subprotocol = extractSubprotocol(req);
    const upgraded = server.upgrade(req, {
        data: {
            userId: user.userId,
            email: user.email,
            name: user.name,
            subscriptions: new Set<string>(),
            connectedAt: Date.now(),
            isAlive: true,
            lastPing: Date.now(),
            lastPong: Date.now()
        },
        headers: subprotocol ? { "Sec-WebSocket-Protocol": subprotocol } : undefined
    });

    if (upgraded)
    {
        return undefined;
    }

    // 5. Fallback for non-upgrade HTTP requests
    return new Response("WebSocket only", {
        status: 426,
        headers: { "Upgrade": "websocket" }
    });
}

export async function handleWebSocketMessage(
    ws: Pick<ServerWebSocket<WebSocketData>, "data" | "subscribe" | "unsubscribe" | "send">,
    server: Pick<Server<WebSocketData>, "publish">,
    rawMessage: string | Buffer,
    checkAccess: BoardAccessChecker = activeBoardAccessChecker
): Promise<void>
{
    let msg: ClientMessage;
    if (ws?.data)
    {
        ws.data.isAlive = true;
        ws.data.lastPong = Date.now();
    }
    if (!ws?.data?.subscriptions)
    {
        try
        {
            ws.send(JSON.stringify({ error: "Unauthenticated socket session" }));
        } catch { }
        return;
    }
    try
    {
        if (!rawMessage && rawMessage !== "")
        {
            ws.send(JSON.stringify({ error: "Invalid message payload: expected JSON object" }));
            return;
        }
        const str = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
        const parsed = JSON.parse(str);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        {
            ws.send(JSON.stringify({ error: "Invalid message payload: expected JSON object" }));
            return;
        }
        msg = parsed as ClientMessage;
    } catch
    {
        ws.send(JSON.stringify({ error: "Invalid JSON message" }));
        return;
    }

    const rawAction = msg.action ?? msg.type;
    const action = typeof rawAction === "string" ? rawAction.toLowerCase() : undefined;
    const rawBoardId = msg.boardId ?? msg.topic ?? msg.roomId;

    if (action === "join" || action === "subscribe")
    {
        if (rawBoardId === undefined || rawBoardId === null)
        {
            ws.send(JSON.stringify({ error: "Missing boardId for join action" }));
            return;
        }
        if (typeof rawBoardId !== "string")
        {
            ws.send(JSON.stringify({ error: "Invalid boardId: boardId must be a string" }));
            return;
        }
        const boardId = rawBoardId.trim();
        if (!boardId)
        {
            ws.send(JSON.stringify({ error: "Missing boardId for join action" }));
            return;
        }

        const topic = formatBoardTopic(boardId);
        if (!topic)
        {
            ws.send(JSON.stringify({ error: "Invalid boardId for join action" }));
            return;
        }

        const cleanId = cleanBoardId(boardId);

        // Fast-path: Check in-memory membership cache if boardOrgMap and userOrgMembership exist
        const cachedOrgId = cleanId ? boardOrgMap.get(cleanId) : undefined;
        let hasAccess = false;
        if (cachedOrgId && userOrgMembership.get(ws.data.userId?.trim())?.has(cachedOrgId))
        {
            hasAccess = true;
        } else
        {
            // Cold path: verify user via access checker (DB or mock)
            const accessResult = checkAccess(ws.data.userId, boardId);
            hasAccess = typeof accessResult === "boolean" ? accessResult : await accessResult;
            if (hasAccess && cachedOrgId && ws.data.userId)
            {
                recordUserMembership(ws.data.userId, cachedOrgId, cleanId);
            }
        }

        if (!hasAccess)
        {
            ws.send(JSON.stringify({
                error: "Access denied: not a member of this board's organization",
                boardId
            }));
            return;
        }

        // If client is already subscribed to this room, acknowledge without re-broadcasting join event
        if (ws.data.subscriptions.has(topic))
        {
            ws.send(JSON.stringify({
                type: "joined",
                boardId,
                alreadySubscribed: true
            }));
            return;
        }

        // Subscribe to canonical room topic
        ws.subscribe(topic);
        ws.data.subscriptions.add(topic);

        // Acknowledge join to sender
        ws.send(JSON.stringify({
            type: "joined",
            boardId
        }));

        // Broadcast user:joined once to board room
        const joinEvent = JSON.stringify({
            type: "user:joined",
            payload: {
                userId: ws.data.userId,
                name: ws.data.name || ws.data.email || ws.data.userId,
                email: ws.data.email,
                boardId
            },
            timestamp: Date.now()
        });
        server.publish(topic, joinEvent);
    } else if (action === "leave" || action === "unsubscribe")
    {
        if (rawBoardId === undefined || rawBoardId === null)
        {
            ws.send(JSON.stringify({ error: "Missing boardId for leave action" }));
            return;
        }
        if (typeof rawBoardId !== "string")
        {
            ws.send(JSON.stringify({ error: "Invalid boardId: boardId must be a string" }));
            return;
        }
        const boardId = rawBoardId.trim();
        if (!boardId)
        {
            ws.send(JSON.stringify({ error: "Missing boardId for leave action" }));
            return;
        }

        const topic = formatBoardTopic(boardId);
        if (!topic)
        {
            ws.send(JSON.stringify({ error: "Invalid boardId for leave action" }));
            return;
        }
        if (!ws.data.subscriptions.has(topic))
        {
            return;
        }

        ws.unsubscribe(topic);
        ws.data.subscriptions.delete(topic);

        ws.send(JSON.stringify({
            type: "left",
            boardId
        }));

        const leaveEvent = JSON.stringify({
            type: "user:left",
            payload: {
                userId: ws.data.userId,
                name: ws.data.name || ws.data.email || ws.data.userId,
                email: ws.data.email,
                boardId
            },
            timestamp: Date.now()
        });
        server.publish(topic, leaveEvent);
    } else if (action === "ping" || action === "heartbeat")
    {
        if (ws?.data)
        {
            ws.data.isAlive = true;
            ws.data.lastPing = Date.now();
        }
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
    } else if (action === "pong" || action === "heartbeat_ack")
    {
        if (ws?.data)
        {
            ws.data.isAlive = true;
            ws.data.lastPong = Date.now();
        }
    } else
    {
        ws.send(JSON.stringify({ error: `Unknown action: ${action}` }));
    }
}

export function handleWebSocketClose(
    ws: Pick<ServerWebSocket<WebSocketData>, "data" | "unsubscribe">,
    server: Pick<Server<WebSocketData>, "publish">,
    _code?: number,
    _reason?: string
): void
{
    if (ws?.data?.userId)
    {
        const cleanUid = ws.data.userId.trim();
        const set = userSocketRegistry.get(cleanUid);
        if (set)
        {
            set.delete(ws as unknown as ServerWebSocket<WebSocketData>);
            if (set.size === 0)
            {
                userSocketRegistry.delete(cleanUid);
                cleanupUserMembership(cleanUid);
            }
        }
    }
    if (!ws?.data?.subscriptions)
    {
        return;
    }
    try
    {
        for (const topic of ws.data.subscriptions)
        {
            try
            {
                server.publish(topic, JSON.stringify({
                    type: "user:left",
                    payload: {
                        userId: ws.data.userId,
                        name: ws.data.name || ws.data.email || ws.data.userId,
                        email: ws.data.email,
                        boardId: cleanBoardId(topic) || topic
                    },
                    timestamp: Date.now()
                }));
            } catch { }

            try
            {
                ws.unsubscribe(topic);
            } catch { }
        }
    } finally
    {
        ws.data.subscriptions.clear();
    }
}

const serverHeartbeatTimers = new Map<Server<WebSocketData> | object, ReturnType<typeof setInterval>>();

export function checkHeartbeats(
    server: Pick<Server<WebSocketData>, "publish">
): { deadSocketsTerminated: number; pingsSent: number }
{
    let deadSocketsTerminated = 0;
    let pingsSent = 0;

    for (const [userId, sockets] of Array.from(userSocketRegistry.entries()))
    {
        const socketsToTerminate: ServerWebSocket<WebSocketData>[] = [];

        for (const ws of Array.from(sockets))
        {
            if (!ws) continue;

            if (ws.data && ws.data.isAlive === false)
            {
                socketsToTerminate.push(ws);
            } else
            {
                if (ws.data)
                {
                    ws.data.isAlive = false;
                    ws.data.lastPing = Date.now();
                }
                try
                {
                    if (typeof ws.ping === "function")
                    {
                        ws.ping();
                    }
                } catch { }
                pingsSent++;
            }
        }

        for (const ws of socketsToTerminate)
        {
            deadSocketsTerminated++;
            try
            {
                handleWebSocketClose(ws, server, 1001, "Zombie connection: heartbeat timeout");
            } catch { }

            try
            {
                if (typeof ws.terminate === "function")
                {
                    ws.terminate();
                } else if (typeof ws.close === "function")
                {
                    ws.close(1001, "Zombie connection: heartbeat timeout");
                }
            } catch { }
        }
    }

    return { deadSocketsTerminated, pingsSent };
}

export function startHeartbeat(
    server: Pick<Server<WebSocketData>, "publish"> & Partial<Pick<Server<WebSocketData>, "stop">>,
    intervalMs: number = 30000
): ReturnType<typeof setInterval> | null
{
    stopHeartbeat(server);
    if (!intervalMs || intervalMs <= 0) return null;

    const timer = setInterval(() =>
    {
        checkHeartbeats(server);
    }, intervalMs);

    if (typeof timer.unref === "function")
    {
        timer.unref();
    }

    serverHeartbeatTimers.set(server, timer);
    return timer;
}

export function stopHeartbeat(server?: Pick<Server<WebSocketData>, "publish"> | object): void
{
    if (server)
    {
        const timer = serverHeartbeatTimers.get(server);
        if (timer)
        {
            clearInterval(timer);
            serverHeartbeatTimers.delete(server);
        }
    } else
    {
        for (const [srv, timer] of serverHeartbeatTimers.entries())
        {
            clearInterval(timer);
        }
        serverHeartbeatTimers.clear();
    }
}

export function createWebSocketServer(options: WebSocketServerOptions = {}): Server<WebSocketData>
{
    const port = options.port ?? Number(process.env.ws_port || process.env.WS_PORT || 3001);
    const jwtSecret = options.jwtSecret ?? process.env.jwt_key ?? process.env.JWT_SECRET;
    if (!jwtSecret)
    {
        throw new Error("JWT secret must be configured for WebSocket server via options.jwtSecret, process.env.jwt_key, or process.env.JWT_SECRET");
    }
    const hostname = options.hostname ?? "0.0.0.0";
    const checker = options.checkAccess ?? activeBoardAccessChecker;

    const idleTimeout = options.idleTimeout ?? (process.env.WS_IDLE_TIMEOUT ? Number(process.env.WS_IDLE_TIMEOUT) : 60);
    const sendPings = options.sendPings ?? true;
    const heartbeatInterval = options.heartbeatInterval !== undefined
        ? options.heartbeatInterval
        : (process.env.WS_HEARTBEAT_INTERVAL !== undefined ? Number(process.env.WS_HEARTBEAT_INTERVAL) : 30000);

    const server = Bun.serve<WebSocketData>({
        port,
        hostname,
        fetch(req, server)
        {
            return handleUpgradeRequest(req, server, jwtSecret);
        },
        websocket: {
            idleTimeout,
            sendPings,
            open(ws: ServerWebSocket<WebSocketData>)
            {
                if (ws.data)
                {
                    ws.data.isAlive = true;
                    ws.data.lastPong = Date.now();
                }
                if (ws.data?.userId)
                {
                    const cleanUid = ws.data.userId.trim();
                    let set = userSocketRegistry.get(cleanUid);
                    if (!set)
                    {
                        set = new Set();
                        userSocketRegistry.set(cleanUid, set);
                    }
                    set.add(ws);
                }
            },
            async message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer)
            {
                if (ws.data)
                {
                    ws.data.isAlive = true;
                    ws.data.lastPong = Date.now();
                }
                await handleWebSocketMessage(ws, server, rawMessage, checker);
            },
            ping(ws: ServerWebSocket<WebSocketData>, _data: Buffer)
            {
                if (ws.data)
                {
                    ws.data.isAlive = true;
                }
            },
            pong(ws: ServerWebSocket<WebSocketData>, _data: Buffer)
            {
                if (ws.data)
                {
                    ws.data.isAlive = true;
                    ws.data.lastPong = Date.now();
                }
            },
            close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string)
            {
                handleWebSocketClose(ws, server, code, reason);
            }
        }
    });

    if (heartbeatInterval > 0)
    {
        startHeartbeat(server, heartbeatInterval);
        const origStop = server.stop.bind(server);
        server.stop = (closeActiveConnections?: boolean) =>
        {
            stopHeartbeat(server);
            return origStop(closeActiveConnections);
        };
    }

    // Register with singleton broadcaster
    wsBroadcaster.setServer(server);
    wsBroadcaster.setEvictionHandler((opts) => evictUserSockets(server, opts));

    return server;
}
