import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { parseJwt, useAuthStore } from "../store/useAuthStore";
import { api } from "../lib/api";

describe("auth-store and jwt helpers", () =>
{
    const originalPost = api.post;
    const originalGet = api.get;

    afterEach(() =>
    {
        api.post = originalPost;
        api.get = originalGet;
    });

    describe("parseJwt", () =>
    {
        it("returns null for empty or invalid token", () =>
        {
            expect(parseJwt("")).toBeNull();
            expect(parseJwt("invalid")).toBeNull();
            expect(parseJwt("a.b")).toBeNull();
        });

        it("correctly decodes standard JWT payload", () =>
        {
            // Create a test JWT payload: {"id":"user-123","email":"test@example.com"}
            const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({ id: "user-123", email: "test@example.com" })).toString("base64url");
            const fakeToken = `${header}.${payload}.signature`;

            const decoded = parseJwt(fakeToken);
            expect(decoded).not.toBeNull();
            expect(decoded?.id).toBe("user-123");
            expect(decoded?.email).toBe("test@example.com");
        });

        it("rejects expired tokens", () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
            // Expired in 2020
            const payload = Buffer.from(JSON.stringify({
                id: "user-123",
                email: "test@example.com",
                exp: Math.floor(Date.now() / 1000) - 3600
            })).toString("base64url");
            const fakeToken = `${header}.${payload}.signature`;

            const decoded = parseJwt(fakeToken);
            expect(decoded).toBeNull();
        });

        it("accepts valid unexpired tokens with exp in future", () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({
                id: "user-123",
                email: "test@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            const fakeToken = `${header}.${payload}.signature`;

            const decoded = parseJwt(fakeToken);
            expect(decoded).not.toBeNull();
            expect(decoded?.id).toBe("user-123");
        });

        it("rejects token strings that do not contain exactly 3 segments", () =>
        {
            expect(parseJwt("part1.part2")).toBeNull();
            expect(parseJwt("part1.part2.part3.part4")).toBeNull();
        });

        it("handles base64url payloads with arbitrary length padding requirements", () =>
        {
            // payload length requiring 1, 2, or 3 pad '=' characters
            const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({
                id: "uuid-pad-test",
                email: "pad@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            const fakeToken = `${header}.${payload}.sig`;

            const decoded = parseJwt(fakeToken);
            expect(decoded).not.toBeNull();
            expect(decoded?.id).toBe("uuid-pad-test");
            expect(decoded?.email).toBe("pad@example.com");
        });
    });

    describe("useAuthStore state management", () =>
    {
        beforeEach(() =>
        {
            useAuthStore.getState().logout();
        });

        it("initializes with logged-out state after logout", () =>
        {
            const state = useAuthStore.getState();
            expect(state.token).toBeNull();
            expect(state.user).toBeNull();
            expect(state.isLoading).toBe(false);
        });

        it("logout resets token and user", () =>
        {
            const payload = Buffer.from(JSON.stringify({ id: "user-456", email: "logout@example.com" })).toString("base64url");
            const fakeToken = `header.${payload}.sig`;

            useAuthStore.getState().setToken(fakeToken);
            expect(useAuthStore.getState().token).toBe(fakeToken);
            expect(useAuthStore.getState().user?.id).toBe("user-456");

            useAuthStore.getState().logout();
            expect(useAuthStore.getState().token).toBeNull();
            expect(useAuthStore.getState().user).toBeNull();
        });

        it("login performs authentication, stores token, and hydrations user profile", async () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({
                id: "uuid-123",
                email: "alice@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            const fakeToken = `${header}.${payload}.signature`;

            api.post = mock((url: string) =>
            {
                if (url === "/api/auth/login")
                {
                    return Promise.resolve({
                        data: { success: true, data: fakeToken }
                    });
                }
                return Promise.reject(new Error("unexpected post"));
            }) as unknown as typeof api.post;

            api.get = mock((url: string) =>
            {
                if (url === "/api/users/me")
                {
                    return Promise.resolve({
                        data: {
                            success: true,
                            data: {
                                id: "uuid-123",
                                email: "alice@example.com",
                                username: "alice_w",
                                name: "Alice Wonderland",
                                avatarUrl: "https://example.com/avatar.png",
                                memberships: [{ role: "admin", org: { name: "Acme Corp" } }]
                            }
                        }
                    });
                }
                return Promise.reject(new Error("unexpected get"));
            }) as unknown as typeof api.get;

            const res = await useAuthStore.getState().login({
                email: " Alice@Example.Com ",
                password: "Password123!"
            });

            expect(res.success).toBe(true);
            const state = useAuthStore.getState();
            expect(state.token).toBe(fakeToken);
            expect(state.user?.id).toBe("uuid-123");
            expect(state.user?.email).toBe("alice@example.com");
            expect(state.user?.username).toBe("alice_w");
            expect(state.user?.name).toBe("Alice Wonderland");
            expect(state.user?.memberships?.length).toBe(1);
        });

        it("login returns error on invalid credentials", async () =>
        {
            api.post = mock(() =>
            {
                const error = Object.assign(new Error("Request failed with status code 401"), {
                    response: {
                        status: 401,
                        data: { success: false, error: "Invalid email or password" }
                    }
                });
                return Promise.reject(error);
            }) as unknown as typeof api.post;

            const res = await useAuthStore.getState().login({
                email: "wrong@example.com",
                password: "wrongPassword"
            });

            expect(res.success).toBe(false);
            expect(res.error).toBe("Invalid email or password");
            expect(useAuthStore.getState().token).toBeNull();
        });

        it("signup registers account and automatically signs in", async () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({
                id: "uuid-789",
                email: "bob@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            const fakeToken = `${header}.${payload}.signature`;

            api.post = mock((url: string) =>
            {
                if (url === "/api/auth/signup")
                {
                    return Promise.resolve({
                        data: {
                            success: true,
                            data: { id: "uuid-789", email: "bob@example.com", username: "bob_builder" }
                        }
                    });
                }
                if (url === "/api/auth/login")
                {
                    return Promise.resolve({
                        data: { success: true, data: fakeToken }
                    });
                }
                return Promise.reject(new Error("unexpected post"));
            }) as unknown as typeof api.post;

            api.get = mock((url: string) =>
            {
                if (url === "/api/users/me")
                {
                    return Promise.resolve({
                        data: {
                            success: true,
                            data: { id: "uuid-789", email: "bob@example.com", username: "bob_builder" }
                        }
                    });
                }
                return Promise.reject(new Error("unexpected get"));
            }) as unknown as typeof api.get;

            const res = await useAuthStore.getState().signup({
                username: "bob_builder",
                email: "bob@example.com",
                password: "Password1!"
            });

            expect(res.success).toBe(true);
            expect(useAuthStore.getState().token).toBe(fakeToken);
            expect(useAuthStore.getState().user?.username).toBe("bob_builder");
        });

        it("signup handles duplicate email collision with friendly error", async () =>
        {
            api.post = mock((url: string) =>
            {
                if (url === "/api/auth/signup")
                {
                    const error = Object.assign(new Error("Request failed with status code 409"), {
                        response: {
                            status: 409,
                            data: { success: false, error: "Data already Exists" }
                        }
                    });
                    return Promise.reject(error);
                }
                return Promise.reject(new Error("unexpected post"));
            }) as unknown as typeof api.post;

            const res = await useAuthStore.getState().signup({
                username: "duplicate",
                email: "exists@example.com",
                password: "Password1!"
            });

            expect(res.success).toBe(false);
            expect(res.error).toBe("An account with this email address already exists.");
        });

        it("signup flags autoLoginFailed if user created but subsequent login fails", async () =>
        {
            api.post = mock((url: string) =>
            {
                if (url === "/api/auth/signup")
                {
                    return Promise.resolve({
                        data: {
                            success: true,
                            data: { id: "uuid-999", email: "charlie@example.com", username: "charlie" }
                        }
                    });
                }
                if (url === "/api/auth/login")
                {
                    const error = Object.assign(new Error("Network error during login"), {
                        response: undefined
                    });
                    return Promise.reject(error);
                }
                return Promise.reject(new Error("unexpected post"));
            }) as unknown as typeof api.post;

            const res = await useAuthStore.getState().signup({
                username: "charlie",
                email: "charlie@example.com",
                password: "Password1!"
            });

            expect(res.success).toBe(false);
            expect(res.autoLoginFailed).toBe(true);
        });

        it("setToken rejects invalid or expired tokens and resets store state", () =>
        {
            // First set a valid token
            const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
            const validPayload = Buffer.from(JSON.stringify({
                id: "valid-1",
                email: "valid@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            useAuthStore.getState().setToken(`${header}.${validPayload}.sig`);
            expect(useAuthStore.getState().token).not.toBeNull();

            // Attempt setting an expired token
            const expiredPayload = Buffer.from(JSON.stringify({
                id: "expired-1",
                email: "expired@example.com",
                exp: Math.floor(Date.now() / 1000) - 3600
            })).toString("base64url");
            useAuthStore.getState().setToken(`${header}.${expiredPayload}.sig`);
            expect(useAuthStore.getState().token).toBeNull();
            expect(useAuthStore.getState().user).toBeNull();

            // Attempt setting a malformed token
            useAuthStore.getState().setToken("not.a.valid.jwt");
            expect(useAuthStore.getState().token).toBeNull();
            expect(useAuthStore.getState().user).toBeNull();
        });

        it("loadUser immediately purges expired token and resets store to unauthenticated state", async () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
            const expiredPayload = Buffer.from(JSON.stringify({
                id: "expired-user",
                email: "expired@example.com",
                exp: Math.floor(Date.now() / 1000) - 60
            })).toString("base64url");
            const expiredToken = `${header}.${expiredPayload}.sig`;

            // Manually set an expired token on the store
            useAuthStore.setState({ token: expiredToken, user: { id: "expired-user", email: "expired@example.com" }, isLoading: true });

            let networkCalled = false;
            api.get = mock(() =>
            {
                networkCalled = true;
                return Promise.resolve({ data: { success: true } });
            }) as unknown as typeof api.get;

            await useAuthStore.getState().loadUser();

            expect(networkCalled).toBe(false);
            const state = useAuthStore.getState();
            expect(state.token).toBeNull();
            expect(state.user).toBeNull();
            expect(state.isLoading).toBe(false);
        });

        it("loadUser purges session and removes token on 401 response", async () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({
                id: "revoked-user",
                email: "revoked@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            const token = `${header}.${payload}.sig`;

            useAuthStore.getState().setToken(token);

            api.get = mock(() =>
            {
                const error = Object.assign(new Error("Unauthorized"), {
                    response: { status: 401 }
                });
                return Promise.reject(error);
            }) as unknown as typeof api.get;

            await useAuthStore.getState().loadUser();

            const state = useAuthStore.getState();
            expect(state.token).toBeNull();
            expect(state.user).toBeNull();
            expect(state.isLoading).toBe(false);
        });

        it("loadUser retains decoded identity when network request encounters temporary non-401 error", async () =>
        {
            const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify({
                id: "offline-user",
                email: "offline@example.com",
                exp: Math.floor(Date.now() / 1000) + 3600
            })).toString("base64url");
            const token = `${header}.${payload}.sig`;

            useAuthStore.getState().setToken(token);

            api.get = mock(() =>
            {
                const error = Object.assign(new Error("500 Internal Server Error"), {
                    response: { status: 500 }
                });
                return Promise.reject(error);
            }) as unknown as typeof api.get;

            await useAuthStore.getState().loadUser();

            const state = useAuthStore.getState();
            expect(state.token).toBe(token);
            expect(state.user?.id).toBe("offline-user");
            expect(state.user?.email).toBe("offline@example.com");
            expect(state.isLoading).toBe(false);
        });
    });
});

