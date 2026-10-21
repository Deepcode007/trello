import jwt, { type JwtPayload } from "jsonwebtoken";

export interface AuthenticatedUser
{
    userId: string;
    email?: string;
    name?: string;
    role?: string;
    rank?: string;
    payload: JwtPayload;
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string>
{
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;

    const pairs = cookieHeader.split(";");
    for (const pair of pairs)
    {
        const index = pair.indexOf("=");
        if (index > 0)
        {
            const key = pair.slice(0, index).trim();
            const val = pair.slice(index + 1).trim();
            try
            {
                cookies[key] = decodeURIComponent(val);
            } catch
            {
                cookies[key] = val;
            }
        }
    }
    return cookies;
}

export function extractSubprotocol(req: Request): string | undefined
{
    const secProtocol = req.headers.get("sec-websocket-protocol");
    if (!secProtocol) return undefined;
    const parts = secProtocol.split(",").map(p => p.trim());
    return parts[0] || undefined;
}

export function extractToken(req: Request): string | null
{
    // 1. Authorization Header (Bearer <token> or raw <token>)
    const authHeader = req.headers.get("authorization");
    if (authHeader)
    {
        const parts = authHeader.trim().split(/\s+/);
        if (parts.length === 2 && parts[0]?.toLowerCase() === "bearer")
        {
            return parts[1] ?? null;
        } else if (parts.length === 1 && parts[0])
        {
            return parts[0];
        }
    }

    // 2. Cookie Header (token, auth_token, jwt, session, etc.)
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader)
    {
        const cookies = parseCookies(cookieHeader);
        const token = cookies.token || cookies.auth_token || cookies.jwt || cookies.session || cookies.session_token;
        if (token) return token;
    }

    // 3. Query string (?token=... or ?auth=... or ?jwt=... or ?access_token=...)
    try
    {
        const url = new URL(req.url);
        let queryToken = url.searchParams.get("token") ||
            url.searchParams.get("auth") ||
            url.searchParams.get("jwt") ||
            url.searchParams.get("access_token") ||
            url.searchParams.get("authorization");

        if (queryToken)
        {
            if (queryToken.toLowerCase().startsWith("bearer "))
            {
                queryToken = queryToken.slice(7).trim();
            }
            if (queryToken) return queryToken;
        }
    } catch
    {
        // invalid URL structure
    }

    // 4. Sec-WebSocket-Protocol (e.g. "bearer, <token>" or "<token>" or "access_token, <token>")
    const secProtocol = req.headers.get("sec-websocket-protocol");
    if (secProtocol)
    {
        const parts = secProtocol.split(",").map(p => p.trim());
        if (parts.length >= 2)
        {
            const first = parts[0]?.toLowerCase();
            if ((first === "bearer" || first === "token" || first === "access_token") && parts[1])
            {
                return parts[1];
            }
        }
        // Check if any part is a valid JWT (3 dot-separated segments)
        for (const part of parts)
        {
            if (part && part.split(".").length === 3)
            {
                return part;
            }
        }
    }

    return null;
}

export function authenticateRequest(req: Request, jwtSecret: string): AuthenticatedUser | null
{
    const token = extractToken(req);
    if (!token) return null;

    try
    {
        const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
        if (!decoded || typeof decoded !== "object") return null;

        const userObj = (decoded.user && typeof decoded.user === "object") ? (decoded.user as Record<string, unknown>) : null;
        const rawUserId = decoded.id ?? decoded.userId ?? decoded.sub ?? userObj?.id ?? userObj?.userId;
        if (!rawUserId) return null;

        const userId = String(rawUserId);
        const email = typeof decoded.email === "string" ? decoded.email : (typeof userObj?.email === "string" ? userObj.email : undefined);
        const rawName = typeof decoded.name === "string" && decoded.name.trim()
            ? decoded.name.trim()
            : (typeof decoded.username === "string" && decoded.username.trim()
                ? decoded.username.trim()
                : (typeof userObj?.username === "string" && userObj.username.trim()
                    ? userObj.username.trim()
                    : undefined));

        const name = (rawName && !rawName.includes("@"))
            ? rawName
            : (email && typeof email === "string" && email.includes("@") ? email.split("@")[0] : rawName);

        const role = typeof decoded.role === "string" && decoded.role.trim()
            ? decoded.role.trim()
            : (typeof userObj?.role === "string" && userObj.role.trim()
                ? userObj.role.trim()
                : (typeof decoded.rank === "string" && decoded.rank.trim()
                    ? decoded.rank.trim()
                    : undefined));
        const rank = typeof decoded.rank === "string" && decoded.rank.trim()
            ? decoded.rank.trim()
            : (typeof userObj?.rank === "string" && userObj.rank.trim()
                ? userObj.rank.trim()
                : role);

        return {
            userId,
            email,
            name,
            role,
            rank,
            payload: decoded
        };
    } catch
    {
        return null;
    }
}
