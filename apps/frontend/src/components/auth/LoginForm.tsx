import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Sparkles, ArrowRight } from "lucide-react";
import { useAuthStore } from "../../store/useAuthStore";
import { validateEmail, getSafeRedirect } from "../../lib/auth-validation";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

export function LoginForm()
{
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const login = useAuthStore(s => s.login);

    const initialEmail = searchParams.get("email") || (typeof window !== "undefined" && window.localStorage ? localStorage.getItem("remembered_email") || "" : "");
    const registered = searchParams.get("registered") === "true";
    const redirectPath = getSafeRedirect(searchParams.get("redirect"));

    const [email, setEmail] = useState(initialEmail);
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(Boolean(typeof window !== "undefined" && window.localStorage && localStorage.getItem("remembered_email")));

    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
    const [isSuccess, setIsSuccess] = useState(false);
    const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() =>
    {
        return () =>
        {
            if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
        };
    }, []);

    useEffect(() =>
    {
        if (registered)
        {
            setErrorMessage(null);
        }
    }, [registered]);

    const handleBlurEmail = () =>
    {
        if (!email) return;
        const res = validateEmail(email);
        if (!res.isValid)
        {
            setFieldErrors(prev => ({ ...prev, email: res.error }));
        } else
        {
            setFieldErrors(prev => ({ ...prev, email: undefined }));
        }
    };

    const handleFillDemo = () =>
    {
        setEmail("demo@kanban.dev");
        setPassword("DemoPass123!");
        setFieldErrors({});
        setErrorMessage(null);
    };

    const handleSubmit = async (e: React.FormEvent) =>
    {
        e.preventDefault();
        if (isLoading || isSuccess) return;
        setErrorMessage(null);

        // Validate inputs
        const errors: { email?: string; password?: string } = {};
        const emailRes = validateEmail(email);
        if (!emailRes.isValid)
        {
            errors.email = emailRes.error;
        }

        if (!password)
        {
            errors.password = "Password is required";
        } else if (password.trim().length < 6)
        {
            errors.password = "Password must be at least 6 characters";
        } else if (password.trim().length > 20)
        {
            errors.password = "Password cannot exceed 20 characters";
        }

        if (Object.keys(errors).length > 0)
        {
            setFieldErrors(errors);
            return;
        }

        setFieldErrors({});
        setIsLoading(true);

        if (rememberMe)
        {
            localStorage.setItem("remembered_email", email.trim());
        } else
        {
            localStorage.removeItem("remembered_email");
        }

        const res = await login({ email, password });
        setIsLoading(false);

        if (res.success)
        {
            setIsSuccess(true);
            navTimeoutRef.current = setTimeout(() =>
            {
                navigate(redirectPath, { replace: true });
            }, 500);
        } else
        {
            setErrorMessage(res.error || "Invalid email or password");
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Registration success banner */}
            {registered && !isSuccess && (
                <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                    <div className="flex-1">
                        <span className="font-semibold">Account created successfully!</span> Please sign in with your password to continue.
                    </div>
                </div>
            )}

            {/* Success banner */}
            {isSuccess && (
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-semibold">Authentication successful. Entering workspace...</span>
                </div>
            )}

            {/* Error banner */}
            {errorMessage && (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <span className="font-semibold">Sign in failed:</span> {errorMessage}
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorMessage(null)}
                        className="text-xs hover:opacity-75 font-bold"
                        aria-label="Dismiss error"
                    >
                        &times;
                    </button>
                </div>
            )}

            {/* Email input */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="login-email" required>Email address</Label>
                </div>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        <Mail className="h-4 w-4" />
                    </div>
                    <Input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        autoFocus
                        disabled={isLoading || isSuccess}
                        placeholder="name@company.com"
                        value={email}
                        onChange={e =>
                        {
                            setEmail(e.target.value);
                            if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: undefined }));
                        }}
                        onBlur={handleBlurEmail}
                        className={`pl-9 ${fieldErrors.email ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    />
                </div>
                {fieldErrors.email && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        {fieldErrors.email}
                    </p>
                )}
            </div>

            {/* Password input */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="login-password" required>Password</Label>
                </div>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        <Lock className="h-4 w-4" />
                    </div>
                    <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        disabled={isLoading || isSuccess}
                        placeholder="••••••••"
                        value={password}
                        onChange={e =>
                        {
                            setPassword(e.target.value);
                            if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: undefined }));
                        }}
                        className={`pl-9 pr-10 ${fieldErrors.password ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
                {fieldErrors.password && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        {fieldErrors.password}
                    </p>
                )}
            </div>

            {/* Remember me & demo helper row */}
            <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none text-muted-foreground hover:text-foreground">
                    <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={e => setRememberMe(e.target.checked)}
                        className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    <span>Remember email</span>
                </label>

                <button
                    type="button"
                    onClick={handleFillDemo}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                >
                    <Sparkles className="h-3 w-3" />
                    <span>Demo credentials</span>
                </button>
            </div>

            {/* Submit button */}
            <Button
                type="submit"
                disabled={isLoading || isSuccess}
                className="w-full h-10 font-semibold text-sm shadow-md transition-all mt-2"
            >
                {isLoading ? (
                    <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Signing in...
                    </span>
                ) : isSuccess ? (
                    <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Welcome back!
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5">
                        Sign In
                        <ArrowRight className="h-4 w-4" />
                    </span>
                )}
            </Button>

            {/* Switch to Signup link */}
            <div className="pt-2 text-center text-xs text-muted-foreground border-t border-border/50">
                Don&apos;t have an account yet?{" "}
                <Link
                    to={`/signup${redirectPath !== "/" ? `?redirect=${encodeURIComponent(redirectPath)}` : ""}`}
                    className="font-semibold text-primary hover:underline"
                >
                    Create an account
                </Link>
            </div>
        </form>
    );
}
