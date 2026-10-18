import React from "react";
import { Link, useLocation } from "react-router-dom";
import
{
    Kanban,
    Zap,
    Users,
    ShieldCheck,
    CheckCircle2,
    Clock
} from "lucide-react";
import { Badge } from "../ui/badge";

interface AuthLayoutProps
{
    children: React.ReactNode;
    title: string;
    subtitle: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps)
{
    const location = useLocation();
    const isLoginPage = location.pathname.startsWith("/login");
    const isSignupPage = location.pathname.startsWith("/signup");

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/20">
            {/* Top navigation */}
            <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-30">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight group">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-105">
                            <Kanban className="h-4 w-4" />
                        </div>
                        <span className="font-extrabold tracking-tight">Kanban</span>
                        <Badge variant="secondary" className="hidden sm:inline-flex text-[10px] font-normal py-0 px-1.5">
                            Realtime v2
                        </Badge>
                    </Link>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground hidden sm:inline-block">
                            {isLoginPage ? "Need a new workspace?" : "Already registered?"}
                        </span>
                        {isLoginPage ? (
                            <Link
                                to={`/signup${location.search}`}
                                className="text-xs font-semibold text-primary hover:underline px-2.5 py-1 rounded-md border border-primary/20 hover:bg-primary/5 transition-colors"
                            >
                                Sign up
                            </Link>
                        ) : (
                            <Link
                                to={`/login${location.search}`}
                                className="text-xs font-semibold text-primary hover:underline px-2.5 py-1 rounded-md border border-primary/20 hover:bg-primary/5 transition-colors"
                            >
                                Sign in
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            {/* Main content grid */}
            <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
                <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    {/* Left Hero Feature Showcase (visible on lg screens) */}
                    <div className="hidden lg:flex lg:col-span-5 flex-col justify-between space-y-8 pr-4">
                        <div className="space-y-4">
                            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                                <Zap className="h-3.5 w-3.5" />
                                <span>Next-Gen Project Management</span>
                            </div>
                            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl leading-tight">
                                Plan, track, and ship tasks with your team in real time.
                            </h1>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Connect directly with native Bun WebSockets, dynamic Kanban boards, custom WIP limits, and team collaboration tools.
                            </p>
                        </div>

                        {/* Interactive Feature Cards */}
                        <div className="space-y-3">
                            <div className="flex items-start gap-3 rounded-lg border bg-card/60 p-3.5 shadow-sm transition-all hover:bg-card/80">
                                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="h-4 w-4" />
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold text-card-foreground">Sub-millisecond Realtime Sync</h4>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Live drag-and-drop card positioning powered by Bun Pub/Sub topics.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 rounded-lg border bg-card/60 p-3.5 shadow-sm transition-all hover:bg-card/80">
                                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                    <Users className="h-4 w-4" />
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold text-card-foreground">Multi-Tenant Organizations</h4>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Role-based access control, pending invitation flows, and live presence stacks.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 rounded-lg border bg-card/60 p-3.5 shadow-sm transition-all hover:bg-card/80">
                                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                    <ShieldCheck className="h-4 w-4" />
                                </div>
                                <div>
                                    <h4 className="text-xs font-semibold text-card-foreground">Enterprise Security</h4>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Constant-time bcrypt verification, JWT auth, and advisory locked transactional outbox.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Testimonial / mini status */}
                        <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                Backend & WebSocket services operational
                            </span>
                            <span className="flex items-center gap-1 font-mono text-[11px]">
                                <Clock className="h-3 w-3" /> 24/7 Sync
                            </span>
                        </div>
                    </div>

                    {/* Right Auth Card Form */}
                    <div className="lg:col-span-7 flex justify-center">
                        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 sm:p-8 shadow-xl relative overflow-hidden backdrop-blur">
                            {/* Subtle decorative glow */}
                            <div className="absolute -top-16 -right-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
                            <div className="absolute -bottom-16 -left-16 h-36 w-36 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

                            {/* Card Header & Switcher */}
                            <div className="relative z-10 space-y-5">
                                {/* Segmented control navigation between Login & Signup */}
                                <div className="grid grid-cols-2 rounded-lg bg-secondary p-1 text-center text-xs font-semibold text-muted-foreground">
                                    <Link
                                        to={`/login${location.search}`}
                                        className={`rounded-md py-1.5 transition-all ${isLoginPage
                                            ? "bg-card text-foreground shadow-sm font-bold"
                                            : "hover:text-foreground"
                                            }`}
                                    >
                                        Log In
                                    </Link>
                                    <Link
                                        to={`/signup${location.search}`}
                                        className={`rounded-md py-1.5 transition-all ${isSignupPage
                                            ? "bg-card text-foreground shadow-sm font-bold"
                                            : "hover:text-foreground"
                                            }`}
                                    >
                                        Create Account
                                    </Link>
                                </div>

                                <div className="space-y-1">
                                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-card-foreground">
                                        {title}
                                    </h2>
                                    <p className="text-xs sm:text-sm text-muted-foreground">
                                        {subtitle}
                                    </p>
                                </div>

                                {/* Form children */}
                                {children}
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t py-4 text-center text-xs text-muted-foreground">
                <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <span>&copy; {new Date().getFullYear()} Kanban Monorepo Project. Built with Bun, React & WebSockets.</span>
                    <div className="flex items-center gap-4">
                        <span className="hover:text-foreground cursor-pointer transition-colors">Documentation</span>
                        <span className="hover:text-foreground cursor-pointer transition-colors">Privacy Policy</span>
                        <span className="hover:text-foreground cursor-pointer transition-colors">Terms of Service</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
