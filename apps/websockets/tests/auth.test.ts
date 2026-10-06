import { describe, expect, it } from "bun:test";
import jwt from "backend/src/helpers/jwt";
import { authenticateRequest, extractToken, parseCookies } from "../src/auth/authUpgrade";

const JWT_SECRET = "super-secret-test-jwt-key";

describe("WebSocket Authentication & Token Extraction Tests", () => {
    const validUserId = "user-123e4567-e89b-12d3-a456-426614174000";
    const validEmail = "alice@example.com";
    const validToken = jwt.sign({ id: validUserId, email: validEmail }, JWT_SECRET, { expiresIn: "1h" });
    const expiredToken = jwt.sign({ id: validUserId, email: validEmail }, JWT_SECRET, { expiresIn: "-1h" });
    const differentSecretToken = jwt.sign({ id: validUserId, email: validEmail }, "different-secret");

    describe("parseCookies helper", () => {
        it("returns empty object for undefined or null header", () => {
            expect(parseCookies(undefined)).toEqual({});
            expect(parseCookies(null)).toEqual({});
            expect(parseCookies("")).toEqual({});
        });

        it("parses single cookie", () => {
            const cookies = parseCookies("token=abc123xyz");
            expect(cookies.token).toBe("abc123xyz");
        });

        it("parses multiple cookies with whitespace and encoding", () => {
            const cookies = parseCookies("session=sess_1; token=jwt_token_val; other=%20hello%20");
            expect(cookies.session).toBe("sess_1");
            expect(cookies.token).toBe("jwt_token_val");
            expect(cookies.other).toBe(" hello ");
        });
    });

    describe("extractToken helper", () => {
        it("extracts token from Authorization: Bearer <token>", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `Bearer ${validToken}` }
            });
            expect(extractToken(req)).toBe(validToken);
        });

        it("extracts token from Authorization: bearer <token> (case-insensitive scheme)", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `bearer ${validToken}` }
            });
            expect(extractToken(req)).toBe(validToken);
        });

        it("extracts raw token from Authorization header without Bearer", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": validToken }
            });
            expect(extractToken(req)).toBe(validToken);
        });

        it("extracts token from Cookie: token=<token>", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "cookie": `token=${validToken}` }
            });
            expect(extractToken(req)).toBe(validToken);
        });

        it("extracts token from Cookie: auth_token=<token>", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "cookie": `auth_token=${validToken}` }
            });
            expect(extractToken(req)).toBe(validToken);
        });

        it("extracts token from URL query string ?token=<token>", () => {
            const req = new Request(`http://localhost:3001/ws?token=${validToken}`);
            expect(extractToken(req)).toBe(validToken);
        });

        it("extracts token from Sec-WebSocket-Protocol", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "sec-websocket-protocol": `Bearer, ${validToken}` }
            });
            expect(extractToken(req)).toBe(validToken);
        });

        it("returns null if no token is provided anywhere", () => {
            const req = new Request("http://localhost:3001/ws");
            expect(extractToken(req)).toBeNull();
        });
    });

    describe("authenticateRequest", () => {
        it("successfully authenticates a valid JWT with id field", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `Bearer ${validToken}` }
            });
            const result = authenticateRequest(req, JWT_SECRET);
            expect(result).not.toBeNull();
            expect(result?.userId).toBe(validUserId);
            expect(result?.email).toBe(validEmail);
        });

        it("successfully authenticates a valid JWT with userId field instead of id", () => {
            const tokenWithUserId = jwt.sign({ userId: validUserId, email: validEmail }, JWT_SECRET);
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `Bearer ${tokenWithUserId}` }
            });
            const result = authenticateRequest(req, JWT_SECRET);
            expect(result).not.toBeNull();
            expect(result?.userId).toBe(validUserId);
        });

        it("returns null when no token is present", () => {
            const req = new Request("http://localhost:3001/ws");
            expect(authenticateRequest(req, JWT_SECRET)).toBeNull();
        });

        it("returns null when signature is invalid (different secret)", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `Bearer ${differentSecretToken}` }
            });
            expect(authenticateRequest(req, JWT_SECRET)).toBeNull();
        });

        it("returns null when token is expired", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `Bearer ${expiredToken}` }
            });
            expect(authenticateRequest(req, JWT_SECRET)).toBeNull();
        });

        it("returns null when token is garbage or malformed", () => {
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": "Bearer this-is-not-a-jwt" }
            });
            expect(authenticateRequest(req, JWT_SECRET)).toBeNull();
        });

        it("returns null when token payload does not contain an id or userId", () => {
            const tokenWithoutUser = jwt.sign({ foo: "bar" }, JWT_SECRET);
            const req = new Request("http://localhost:3001/ws", {
                headers: { "authorization": `Bearer ${tokenWithoutUser}` }
            });
            expect(authenticateRequest(req, JWT_SECRET)).toBeNull();
        });

        it("extracts token from ?access_token= and ?jwt= and ?authorization=Bearer%20 query parameters", () => {
            const req1 = new Request(`http://localhost:3001/ws?access_token=${validToken}`);
            const result1 = authenticateRequest(req1, JWT_SECRET);
            expect(result1).not.toBeNull();
            expect(result1?.userId).toBe(validUserId);

            const req2 = new Request(`http://localhost:3001/ws?authorization=Bearer%20${validToken}`);
            const result2 = authenticateRequest(req2, JWT_SECRET);
            expect(result2).not.toBeNull();
            expect(result2?.userId).toBe(validUserId);
        });

        it("authenticates when userId is integer or in nested user object", () => {
            const tokenNested = jwt.sign({ user: { id: "nested-123", email: "nested@test.com" } }, JWT_SECRET);
            const req1 = new Request(`http://localhost:3001/ws?token=${tokenNested}`);
            const result1 = authenticateRequest(req1, JWT_SECRET);
            expect(result1).not.toBeNull();
            expect(result1?.userId).toBe("nested-123");
            expect(result1?.email).toBe("nested@test.com");

            const tokenIntId = jwt.sign({ id: 12345 }, JWT_SECRET);
            const req2 = new Request(`http://localhost:3001/ws?token=${tokenIntId}`);
            const result2 = authenticateRequest(req2, JWT_SECRET);
            expect(result2).not.toBeNull();
            expect(result2?.userId).toBe("12345");
        });
    });
});
