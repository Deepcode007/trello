import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Kanban, LogOut, User as UserIcon } from "lucide-react";
import { useAuthStore } from "./store/useAuthStore";
import { Button } from "./components/ui/button";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { getSafeRedirect } from "./lib/auth-validation";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1
        }
    }
});

function ProtectedRoute({ children }: { children: React.ReactNode })
{
    const { token, isLoading } = useAuthStore();
    const location = useLocation();

    if (isLoading)
    {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!token)
    {
        const redirectQuery =
            location.pathname !== "/"
                ? `?redirect=${encodeURIComponent(location.pathname + location.search)}`
                : "";
        return <Navigate to={`/login${redirectQuery}`} replace />;
    }

    return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode })
{
    const { token, isLoading } = useAuthStore();
    const [searchParams] = useSearchParams();
    const redirectPath = getSafeRedirect(searchParams.get("redirect"));

    if (isLoading)
    {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (token)
    {
        return <Navigate to={redirectPath} replace />;
    }

    return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode })
{
    const { user, logout } = useAuthStore();

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <Link to="/" className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                            <Kanban className="h-4 w-4" />
                        </div>
                        <span className="font-extrabold tracking-tight">Kanban</span>
                    </Link>

                    <div className="flex items-center gap-3">
                        {user ? (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-2.5 py-1 rounded-full border border-border/50">
                                    <UserIcon className="h-3.5 w-3.5" />
                                    <span className="font-medium text-foreground text-xs">{user.username || user.name || user.email}</span>
                                </div>
                                <Button variant="outline" size="sm" onClick={logout} className="h-8 gap-1.5 text-xs">
                                    <LogOut className="h-3.5 w-3.5" />
                                    Log out
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Link to="/login">
                                    <Button variant="ghost" size="sm" className="h-8 text-xs">Log in</Button>
                                </Link>
                                <Link to="/signup">
                                    <Button size="sm" className="h-8 text-xs">Sign up</Button>
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </header>
            <main className="flex-1">{children}</main>
        </div>
    );
}

function DashboardPage()
{
    const user = useAuthStore(s => s.user);

    return (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b pb-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            Welcome back, {user?.username || user?.name || user?.email || "User"}!
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Your real-time Kanban workspace is active and authenticated.
                        </p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Session Active
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="rounded-lg border bg-secondary/30 p-4">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">User ID</div>
                        <div className="font-mono text-xs mt-1 text-foreground break-all">{user?.id || "N/A"}</div>
                    </div>
                    <div className="rounded-lg border bg-secondary/30 p-4">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Email</div>
                        <div className="font-medium text-sm mt-1 text-foreground">{user?.email || "N/A"}</div>
                    </div>
                    <div className="rounded-lg border bg-secondary/30 p-4">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Username</div>
                        <div className="font-medium text-sm mt-1 text-foreground">@{user?.username || "unassigned"}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function App()
{
    const loadUser = useAuthStore(s => s.loadUser);

    useEffect(() =>
    {
        loadUser();
    }, [loadUser]);

    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <Routes>
                    <Route
                        path="/login"
                        element={
                            <PublicOnlyRoute>
                                <LoginPage />
                            </PublicOnlyRoute>
                        }
                    />
                    <Route
                        path="/signup"
                        element={
                            <PublicOnlyRoute>
                                <SignupPage />
                            </PublicOnlyRoute>
                        }
                    />
                    <Route
                        path="/"
                        element={
                            <ProtectedRoute>
                                <AppLayout>
                                    <DashboardPage />
                                </AppLayout>
                            </ProtectedRoute>
                        }
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </QueryClientProvider>
    );
}

export default App;
