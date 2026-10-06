import type { Server, ServerWebSocket } from "bun";
import { prisma } from "db/prisma";
import { authenticateRequest, extractSubprotocol } from "./auth/authUpgrade";
import { wsBroadcaster } from "./services/broadcaster";
import {
    type WebSocketData,
    type ClientMessage,
    formatBoardTopic,
    cleanBoardId
} from "./types/events";

export type BoardAccessChecker = (userId: string, boardId: string) => Promise<boolean> | boolean;

export async function defaultCheckBoardAccess(userId: string, boardId: string): Promise<boolean> {
    const rawId = cleanBoardId(boardId);
    if (!rawId || !userId) return false;
    try {
        const board = await prisma.boards.findUnique({
            where: { id: rawId },
            select: {
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
        return Boolean(board && board.org.members.length > 0);
    } catch {
        return false;
    }
}

let activeBoardAccessChecker: BoardAccessChecker = defaultCheckBoardAccess;

export function setBoardAccessChecker(checker: BoardAccessChecker): void {
    activeBoardAccessChecker = checker;
}

export function resetBoardAccessChecker(): void {
    activeBoardAccessChecker = defaultCheckBoardAccess;
}

export interface WebSocketServerOptions {
    port?: number;
    jwtSecret?: string;
    hostname?: string;
    checkAccess?: BoardAccessChecker;
}

// Layer 2 In-Memory Connection Registry: maps authenticated userId to active sockets
export const userSocketRegistry = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

export function handleUpgradeRequest(
    req: Request,
    server: Pick<Server<WebSocketData>, "upgrade" | "publish" | "port">,
    jwtSecret: string
): Promise<Response | undefined> | Response | undefined {
    const url = new URL(req.url);

    // 1. Internal broadcast endpoint for inter-process communication
    if (req.method === "POST" && url.pathname === "/internal/broadcast") {
        return (async () => {
            try {
                // Internal secret protection if secret is configured (decoupled with fallback)
                const expectedSecret = process.env.INTERNAL_BROADCAST_SECRET || jwtSecret;
                const internalSecret = req.headers.get("x-internal-secret");
                if (expectedSecret && internalSecret !== expectedSecret) {
                    return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json" }
                    });
                }

                const body = await req.json() as { boardId?: string; event?: unknown };
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                if (!body.boardId || typeof body.boardId !== "string" || !body.boardId.trim() || !body.event) {
                    return new Response(JSON.stringify({ error: "Missing boardId or event" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const topic = formatBoardTopic(body.boardId);
                if (!topic) {
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
                if (topic !== body.boardId) {
                    wsBroadcaster.emit(`board:${topic}`, body.event);
                }

                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            } catch {
                return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
        })();
    }

    // 1b. Internal administrative endpoint to forcibly evict a user's active sockets
    if (req.method === "POST" && url.pathname === "/internal/evict-user") {
        return (async () => {
            try {
                const expectedSecret = process.env.INTERNAL_BROADCAST_SECRET || jwtSecret;
                const internalSecret = req.headers.get("x-internal-secret");
                if (expectedSecret && internalSecret !== expectedSecret) {
                    return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const body = await req.json() as { userId?: string; orgId?: string; reason?: string };
                if (!body?.userId || typeof body.userId !== "string") {
                    return new Response(JSON.stringify({ error: "Missing or invalid userId" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                const sockets = userSocketRegistry.get(body.userId);
                let evictedCount = 0;
                if (sockets && sockets.size > 0) {
                    evictedCount = sockets.size;
                    for (const ws of sockets) {
                        for (const topic of ws.data.subscriptions) {
                            try { ws.unsubscribe(topic); } catch {}
                        }
                        ws.data.subscriptions.clear();
                        try { ws.close(4003, body.reason || "FORBIDDEN_REVOKED: Organization membership terminated"); } catch {}
                    }
                    userSocketRegistry.delete(body.userId);
                }
                return new Response(JSON.stringify({ success: true, evictedCount }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            } catch {
                return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }
        })();
    }

    // 2. Health check route
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
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
    if (!user) {
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
            connectedAt: Date.now()
        },
        headers: subprotocol ? { "Sec-WebSocket-Protocol": subprotocol } : undefined
    });

    if (upgraded) {
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
): Promise<void> {
    let msg: ClientMessage;
    if (!ws?.data?.subscriptions) {
        try {
            ws.send(JSON.stringify({ error: "Unauthenticated socket session" }));
        } catch {}
        return;
    }
    try {
        if (!rawMessage && rawMessage !== "") {
            ws.send(JSON.stringify({ error: "Invalid message payload: expected JSON object" }));
            return;
        }
        const str = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
        const parsed = JSON.parse(str);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            ws.send(JSON.stringify({ error: "Invalid message payload: expected JSON object" }));
            return;
        }
        msg = parsed as ClientMessage;
    } catch {
        ws.send(JSON.stringify({ error: "Invalid JSON message" }));
        return;
    }

    const rawAction = msg.action ?? msg.type;
    const action = typeof rawAction === "string" ? rawAction.toLowerCase() : undefined;
    const rawBoardId = msg.boardId ?? msg.topic ?? msg.roomId;

    if (action === "join" || action === "subscribe") {
        if (rawBoardId === undefined || rawBoardId === null) {
            ws.send(JSON.stringify({ error: "Missing boardId for join action" }));
            return;
        }
        if (typeof rawBoardId !== "string") {
            ws.send(JSON.stringify({ error: "Invalid boardId: boardId must be a string" }));
            return;
        }
        const boardId = rawBoardId.trim();
        if (!boardId) {
            ws.send(JSON.stringify({ error: "Missing boardId for join action" }));
            return;
        }

        const topic = formatBoardTopic(boardId);
        if (!topic) {
            ws.send(JSON.stringify({ error: "Invalid boardId for join action" }));
            return;
        }

        // Verify user is an accepted member of the board's organization
        const accessResult = checkAccess(ws.data.userId, boardId);
        const hasAccess = typeof accessResult === "boolean" ? accessResult : await accessResult;
        if (!hasAccess) {
            ws.send(JSON.stringify({
                error: "Access denied: not a member of this board's organization",
                boardId
            }));
            return;
        }

        // If client is already subscribed to this room, acknowledge without re-broadcasting join event
        if (ws.data.subscriptions.has(topic)) {
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
    } else if (action === "leave" || action === "unsubscribe") {
        if (rawBoardId === undefined || rawBoardId === null) {
            ws.send(JSON.stringify({ error: "Missing boardId for leave action" }));
            return;
        }
        if (typeof rawBoardId !== "string") {
            ws.send(JSON.stringify({ error: "Invalid boardId: boardId must be a string" }));
            return;
        }
        const boardId = rawBoardId.trim();
        if (!boardId) {
            ws.send(JSON.stringify({ error: "Missing boardId for leave action" }));
            return;
        }

        const topic = formatBoardTopic(boardId);
        if (!topic) {
            ws.send(JSON.stringify({ error: "Invalid boardId for leave action" }));
            return;
        }
        if (!ws.data.subscriptions.has(topic)) {
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
    } else if (action === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
    } else {
        ws.send(JSON.stringify({ error: `Unknown action: ${action}` }));
    }
}

export function handleWebSocketClose(
    ws: Pick<ServerWebSocket<WebSocketData>, "data" | "unsubscribe">,
    server: Pick<Server<WebSocketData>, "publish">,
    _code?: number,
    _reason?: string
): void {
    if (ws?.data?.userId) {
        const set = userSocketRegistry.get(ws.data.userId);
        if (set) {
            set.delete(ws as unknown as ServerWebSocket<WebSocketData>);
            if (set.size === 0) {
                userSocketRegistry.delete(ws.data.userId);
            }
        }
    }
    if (!ws?.data?.subscriptions) {
        return;
    }
    try {
        for (const topic of ws.data.subscriptions) {
            try {
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
            } catch {}

            try {
                ws.unsubscribe(topic);
            } catch {}
        }
    } finally {
        ws.data.subscriptions.clear();
    }
}

export function createWebSocketServer(options: WebSocketServerOptions = {}): Server<WebSocketData> {
    const port = options.port ?? Number(process.env.ws_port || process.env.WS_PORT || 3001);
    const jwtSecret = options.jwtSecret ?? process.env.jwt_key ?? process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error("JWT secret must be configured for WebSocket server via options.jwtSecret, process.env.jwt_key, or process.env.JWT_SECRET");
    }
    const hostname = options.hostname ?? "0.0.0.0";
    const checker = options.checkAccess ?? activeBoardAccessChecker;

    const server = Bun.serve<WebSocketData>({
        port,
        hostname,
        fetch(req, server) {
            return handleUpgradeRequest(req, server, jwtSecret);
        },
        websocket: {
            open(ws: ServerWebSocket<WebSocketData>) {
                if (ws.data?.userId) {
                    let set = userSocketRegistry.get(ws.data.userId);
                    if (!set) {
                        set = new Set();
                        userSocketRegistry.set(ws.data.userId, set);
                    }
                    set.add(ws);
                }
            },
            async message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
                await handleWebSocketMessage(ws, server, rawMessage, checker);
            },
            close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
                handleWebSocketClose(ws, server, code, reason);
            }
        }
    });

    // Register with singleton broadcaster
    wsBroadcaster.setServer(server);

    return server;
}
