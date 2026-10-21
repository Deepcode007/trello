import { create } from "zustand";
import { api, setOnUnauthorized } from "../lib/api";

export interface UserMembership
{
    role: string;
    org: {
        name: string;
    };
}

export interface User
{
    id: string;
    email: string;
    username?: string;
    name?: string | null;
    avatarUrl?: string | null;
    memberships?: UserMembership[];
}

export interface AuthState
{
    token: string | null;
    user: User | null;
    isLoading: boolean;
    setToken: (token: string) => void;
    logout: () => void;
    loadUser: () => Promise<void>;
    login: (credentials: { email: string; password: string }) => Promise<{ success: boolean; error?: string }>;
    signup: (data: { username: string; email: string; password: string }) => Promise<{
        success: boolean;
        autoLoginFailed?: boolean;
        error?: string;
    }>;
}

export function parseJwt(token: string): { id: string; email: string; name?: string; username?: string; exp?: number } | null
{
    try
    {
        if (!token || typeof token !== "string") return null;
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const base64Url = parts[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const pad = (4 - (base64.length % 4)) % 4;
        const padded = base64 + "=".repeat(pad);
        const jsonPayload = decodeURIComponent(
            atob(padded)
                .split("")
                .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );
        const parsed = JSON.parse(jsonPayload);
        if (!parsed || typeof parsed !== "object") return null;

        // Check token expiration if present
        if (typeof parsed.exp === "number" && Date.now() >= parsed.exp * 1000)
        {
            return null;
        }

        if (parsed.id && parsed.email)
        {
            const rawName = typeof parsed.name === "string" && parsed.name.trim()
                ? parsed.name.trim()
                : (typeof parsed.username === "string" && parsed.username.trim()
                    ? parsed.username.trim()
                    : undefined);
            const cleanName = (rawName && !rawName.includes("@"))
                ? rawName
                : (typeof parsed.email === "string" && parsed.email.includes("@") ? parsed.email.split("@")[0] : rawName);

            return {
                id: String(parsed.id),
                email: String(parsed.email),
                name: cleanName,
                username: typeof parsed.username === "string" ? parsed.username : cleanName,
                exp: parsed.exp
            };
        }
        return null;
    } catch
    {
        return null;
    }
}


const getInitialToken = (): string | null =>
{
    if (typeof window === "undefined" || !window.localStorage) return null;
    const token = localStorage.getItem("token");
    if (!token) return null;
    const decoded = parseJwt(token);
    if (!decoded)
    {
        localStorage.removeItem("token");
        return null;
    }
    return token;
};

const initialToken = getInitialToken();
const initialDecoded = initialToken ? parseJwt(initialToken) : null;

export const useAuthStore = create<AuthState>((set, get) => ({
    token: initialToken,
    user: initialDecoded ? {
        id: initialDecoded.id,
        email: initialDecoded.email,
        name: initialDecoded.name,
        username: initialDecoded.username
    } : null,
    isLoading: Boolean(initialToken),

    setToken: (token: string) =>
    {
        const decoded = parseJwt(token);
        if (!decoded)
        {
            if (typeof window !== "undefined" && window.localStorage)
            {
                localStorage.removeItem("token");
            }
            set({ token: null, user: null });
            return;
        }

        if (typeof window !== "undefined" && window.localStorage)
        {
            localStorage.setItem("token", token);
        }
        set({
            token,
            user: {
                id: decoded.id,
                email: decoded.email,
                name: decoded.name,
                username: decoded.username
            }
        });
    },

    logout: () =>
    {
        if (typeof window !== "undefined" && window.localStorage)
        {
            localStorage.removeItem("token");
        }
        set({ token: null, user: null, isLoading: false });
    },

    login: async ({ email, password }) =>
    {
        try
        {
            const trimmedEmail = email.trim().toLowerCase();
            const trimmedPassword = password.trim();

            const res = await api.post("/api/auth/login", {
                email: trimmedEmail,
                password: trimmedPassword
            });

            if (res.data?.success && res.data.data)
            {
                const token = res.data.data;
                get().setToken(token);
                // Immediately hydrate full user profile (username, avatar, etc.)
                await get().loadUser();
                return { success: true };
            }

            return {
                success: false,
                error: res.data?.error || "Invalid server response during authentication"
            };
        } catch (err: unknown)
        {
            const axiosErr = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
            const errorMessage =
                axiosErr.response?.data?.error ||
                axiosErr.message ||
                "Invalid email or password";
            return { success: false, error: errorMessage };
        }
    },

    signup: async ({ username, email, password }) =>
    {
        const trimmedUsername = username.trim();
        const trimmedEmail = email.trim().toLowerCase();
        const trimmedPassword = password.trim();

        try
        {
            const res = await api.post("/api/auth/signup", {
                username: trimmedUsername,
                email: trimmedEmail,
                password: trimmedPassword
            });

            if (res.data?.success)
            {
                // Automatically authenticate user following successful account creation
                const loginRes = await get().login({ email: trimmedEmail, password: trimmedPassword });
                if (!loginRes.success)
                {
                    return {
                        success: false,
                        autoLoginFailed: true,
                        error: "Account created successfully! Please sign in with your credentials."
                    };
                }

                // Ensure username from registration is retained
                const currentUser = get().user;
                if (currentUser && !currentUser.username)
                {
                    set({ user: { ...currentUser, username: trimmedUsername } });
                }
                return { success: true };
            }

            return {
                success: false,
                error: res.data?.error || "Registration failed"
            };
        } catch (err: unknown)
        {
            const axiosErr = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
            let errorMessage =
                axiosErr.response?.data?.error ||
                axiosErr.message ||
                "Failed to create account";

            if (errorMessage === "Data already Exists")
            {
                errorMessage = "An account with this email address already exists.";
            } else if (errorMessage === "Bad Reuqest/Invalid Inputs" || errorMessage === "Bad Request/Invalid Inputs")
            {
                errorMessage = "Please make sure your email, username, and password meet all format requirements.";
            }

            return { success: false, error: errorMessage };
        }
    },

    loadUser: async () =>
    {
        const token = get().token;
        if (!token)
        {
            set({ user: null, isLoading: false });
            return;
        }

        const decoded = parseJwt(token);
        if (!decoded)
        {
            if (typeof window !== "undefined" && window.localStorage)
            {
                localStorage.removeItem("token");
            }
            set({ token: null, user: null, isLoading: false });
            return;
        }

        try
        {
            const res = await api.get("/api/users/me");
            if (res.data?.success && res.data.data)
            {
                const u = res.data.data;
                set({
                    user: {
                        id: u.id || decoded.id,
                        email: u.email || decoded.email,
                        username: u.username,
                        name: u.name,
                        avatarUrl: u.avatarUrl,
                        memberships: u.memberships
                    },
                    isLoading: false
                });
                return;
            }
        } catch (err: unknown)
        {
            const axiosErr = err as { response?: { status?: number } };
            if (axiosErr.response?.status === 401)
            {
                if (typeof window !== "undefined" && window.localStorage)
                {
                    localStorage.removeItem("token");
                }
                set({ token: null, user: null, isLoading: false });
                return;
            }

            // If network fails temporarily but token was decodable, retain decoded identity
            const currentUser = get().user;
            set({
                user: {
                    id: decoded.id,
                    email: decoded.email,
                    username: currentUser?.username,
                    name: currentUser?.name,
                    avatarUrl: currentUser?.avatarUrl,
                    memberships: currentUser?.memberships
                },
                isLoading: false
            });
            return;
        }

        set({ isLoading: false });
    }
}));

// Wire up API 401 handler to sync with store
setOnUnauthorized(() => {
    useAuthStore.getState().logout();
});

