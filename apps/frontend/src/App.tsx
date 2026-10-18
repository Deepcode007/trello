import React, { useEffect, useState, useMemo } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    Kanban,
    LogOut,
    User as UserIcon,
    Users,
    Mail,
    Building2,
    Shield,
    PlusCircle,
    CheckCircle2
} from "lucide-react";
import { useAuthStore } from "./store/useAuthStore";
import { useOrgStore } from "./store/useOrgStore";
import { useRole } from "./hooks/useRole";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { OrgSwitcher } from "./components/org/OrgSwitcher";
import { MemberManagementModal } from "./components/org/MemberManagementModal";
import { PendingInvitesModal } from "./components/org/PendingInvitesModal";
import { CreateOrgModal } from "./components/org/CreateOrgModal";
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
    const user = useAuthStore(s => s.user);
    const logout = useAuthStore(s => s.logout);
    const resetOrgState = useOrgStore(s => s.resetOrgState);
    const activeOrgId = useOrgStore(s => s.activeOrgId);
    const memberships = useOrgStore(s => s.memberships);
    const pendingInvites = useMemo(() => memberships.filter(m => !m.accepted), [memberships]);
    const { isAdmin } = useRole(activeOrgId || undefined);

    const [headerMembersOpen, setHeaderMembersOpen] = useState(false);
    const [headerInvitesOpen, setHeaderInvitesOpen] = useState(false);

    const handleLogout = () =>
    {
        logout();
        resetOrgState();
    };

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-3 sm:gap-6">
                        <Link to="/" className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                                <Kanban className="h-4 w-4" />
                            </div>
                            <span className="font-extrabold tracking-tight">Kanban</span>
                        </Link>

                        {user && <OrgSwitcher />}
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                        {user ? (
                            <div className="flex items-center gap-2 sm:gap-3">
                                {isAdmin && activeOrgId && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setHeaderMembersOpen(true)}
                                        className="h-8 gap-1.5 text-xs hidden md:inline-flex"
                                    >
                                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>Members</span>
                                    </Button>
                                )}
                                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-2.5 py-1 rounded-full border border-border/50">
                                    <UserIcon className="h-3.5 w-3.5" />
                                    <span className="font-medium text-foreground text-xs">{user.username || user.name || user.email}</span>
                                </div>
                                <Button variant="outline" size="sm" onClick={handleLogout} className="h-8 gap-1.5 text-xs">
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

                {/* Prominent Pending Invitations Notification Bar */}
                {user && pendingInvites.length > 0 && (
                    <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
                        <div className="mx-auto flex max-w-7xl items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>
                                    You have <strong>{pendingInvites.length}</strong> pending organization invitation
                                    {pendingInvites.length > 1 ? "s" : ""}.
                                </span>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setHeaderInvitesOpen(true)}
                                className="h-6 px-2.5 text-[11px] font-semibold border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-100 shadow-none"
                            >
                                Review & Accept
                            </Button>
                        </div>
                    </div>
                )}
            </header>

            <main className="flex-1">{children}</main>

            {/* Layout Level Modals */}
            {activeOrgId && (
                <MemberManagementModal
                    open={headerMembersOpen}
                    onOpenChange={setHeaderMembersOpen}
                    orgId={activeOrgId}
                />
            )}
            <PendingInvitesModal
                open={headerInvitesOpen}
                onOpenChange={setHeaderInvitesOpen}
            />
        </div>
    );
}

function DashboardPage()
{
    const user = useAuthStore(s => s.user);
    const activeOrgId = useOrgStore(s => s.activeOrgId);
    const memberships = useOrgStore(s => s.memberships);
    const activeOrg = useMemo(() => {
        if (!activeOrgId) return null;
        return memberships.find(m => m.orgId === activeOrgId && m.accepted)?.org || null;
    }, [memberships, activeOrgId]);
    const { role, isAdmin } = useRole(activeOrgId || undefined);

    const [createOrgOpen, setCreateOrgOpen] = useState(false);
    const [membersModalOpen, setMembersModalOpen] = useState(false);

    return (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
            {/* User Session Welcome Card */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b pb-4 flex-wrap gap-2">
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

            {/* Active Organization Context Card */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
                {activeOrg ? (
                    <div>
                        <div className="flex items-start justify-between border-b pb-4 flex-wrap gap-3">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                        <Building2 className="h-4 w-4" />
                                    </div>
                                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                                        {activeOrg.name}
                                    </h2>
                                    {role && (
                                        <Badge
                                            variant={role === "admin" ? "default" : role === "employee" ? "secondary" : "outline"}
                                            className="text-xs font-semibold uppercase tracking-wider"
                                        >
                                            {role}
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-sm text-muted-foreground max-w-2xl mt-1">
                                    {activeOrg.description || "No description provided."}
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                {isAdmin && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setMembersModalOpen(true)}
                                        className="h-8 gap-1.5 text-xs font-medium"
                                    >
                                        <Users className="h-3.5 w-3.5" />
                                        Manage Members
                                    </Button>
                                )}
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setCreateOrgOpen(true)}
                                    className="h-8 gap-1.5 text-xs font-medium"
                                >
                                    <PlusCircle className="h-3.5 w-3.5" />
                                    New Organization
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-4">
                            <div className="rounded-lg border bg-secondary/30 p-3.5">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase">Organization ID</div>
                                <div className="font-mono text-xs mt-1 text-foreground truncate">{activeOrg.id}</div>
                            </div>
                            <div className="rounded-lg border bg-secondary/30 p-3.5">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase">Visibility</div>
                                <div className="text-xs font-medium mt-1 text-foreground">
                                    {activeOrg.visible ? "Public workspace" : "Private workspace"}
                                </div>
                            </div>
                            <div className="rounded-lg border bg-secondary/30 p-3.5">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase">Your Permissions</div>
                                <div className="text-xs font-medium mt-1 text-foreground flex items-center gap-1">
                                    <Shield className="h-3 w-3 text-primary" />
                                    {isAdmin ? "Full Admin Control" : role === "employee" ? "Board & Issue Creation" : "View & Comment"}
                                </div>
                            </div>
                            <div className="rounded-lg border bg-secondary/30 p-3.5">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase">Status</div>
                                <div className="text-xs font-medium mt-1 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Active Membership
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                            <Building2 className="h-6 w-6 opacity-60" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-semibold text-base text-foreground">No Active Organization</h3>
                            <p className="text-xs text-muted-foreground max-w-sm">
                                Create an organization workspace or accept an invitation to begin collaborating on team boards.
                            </p>
                        </div>
                        <Button
                            size="sm"
                            onClick={() => setCreateOrgOpen(true)}
                            className="gap-1.5 text-xs font-medium"
                        >
                            <PlusCircle className="h-3.5 w-3.5" />
                            Create Organization
                        </Button>
                    </div>
                )}
            </div>

            {/* Dashboard Modals */}
            <CreateOrgModal
                open={createOrgOpen}
                onOpenChange={setCreateOrgOpen}
            />
            {activeOrgId && (
                <MemberManagementModal
                    open={membersModalOpen}
                    onOpenChange={setMembersModalOpen}
                    orgId={activeOrgId}
                />
            )}
        </div>
    );
}

export function App()
{
    const token = useAuthStore(s => s.token);
    const loadUser = useAuthStore(s => s.loadUser);
    const loadOrgs = useOrgStore(s => s.loadOrgs);

    useEffect(() =>
    {
        loadUser();
    }, [loadUser]);

    useEffect(() =>
    {
        if (token)
        {
            loadOrgs();
        }
    }, [token, loadOrgs]);

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
