import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import
{
    User,
    Mail,
    Lock,
    Eye,
    EyeOff,
    Loader2,
    AlertCircle,
    CheckCircle2,
    ArrowRight,
    ShieldCheck
} from "lucide-react";
import { useAuthStore } from "../../store/useAuthStore";
import
{
    validateEmail,
    validateUsername,
    evaluatePassword,
    validateConfirmPassword,
    getSafeRedirect
} from "../../lib/auth-validation";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";

export function SignupForm()
{
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const signup = useAuthStore(s => s.signup);

    const redirectPath = getSafeRedirect(searchParams.get("redirect"));

    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [agreeTerms, setAgreeTerms] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{
        username?: string;
        email?: string;
        password?: string;
        confirmPassword?: string;
        agreeTerms?: string;
    }>({});
    const [isSuccess, setIsSuccess] = useState(false);
    const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() =>
    {
        return () =>
        {
            if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
        };
    }, []);

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

    const handleBlurUsername = () =>
    {
        if (!username) return;
        const res = validateUsername(username);
        if (!res.isValid)
        {
            setFieldErrors(prev => ({ ...prev, username: res.error }));
        } else
        {
            setFieldErrors(prev => ({ ...prev, username: undefined }));
        }
    };

    const handleBlurConfirmPassword = () =>
    {
        if (!confirmPassword) return;
        const res = validateConfirmPassword(password, confirmPassword);
        if (!res.isValid)
        {
            setFieldErrors(prev => ({ ...prev, confirmPassword: res.error }));
        } else
        {
            setFieldErrors(prev => ({ ...prev, confirmPassword: undefined }));
        }
    };

    const handleSubmit = async (e: React.FormEvent) =>
    {
        e.preventDefault();
        if (isLoading || isSuccess) return;
        setErrorMessage(null);

        const errors: typeof fieldErrors = {};

        // Validate username
        const usernameRes = validateUsername(username);
        if (!usernameRes.isValid)
        {
            errors.username = usernameRes.error;
        }

        // Validate email
        const emailRes = validateEmail(email);
        if (!emailRes.isValid)
        {
            errors.email = emailRes.error;
        }

        // Validate password
        const pwdEval = evaluatePassword(password);
        if (!pwdEval.isValid)
        {
            errors.password = "Please fulfill all password requirements below";
        }

        // Validate confirm password
        const confirmRes = validateConfirmPassword(password, confirmPassword);
        if (!confirmRes.isValid)
        {
            errors.confirmPassword = confirmRes.error;
        }

        // Validate terms agreement
        if (!agreeTerms)
        {
            errors.agreeTerms = "You must agree to the terms to register an account";
        }

        if (Object.keys(errors).length > 0)
        {
            setFieldErrors(errors);
            return;
        }

        setFieldErrors({});
        setIsLoading(true);

        const res = await signup({ username, email, password });
        setIsLoading(false);

        if (res.success)
        {
            setIsSuccess(true);
            navTimeoutRef.current = setTimeout(() =>
            {
                navigate(redirectPath, { replace: true });
            }, 700);
        } else if (res.autoLoginFailed)
        {
            navigate(`/login?registered=true&email=${encodeURIComponent(email.trim().toLowerCase())}${redirectPath !== "/" ? `&redirect=${encodeURIComponent(redirectPath)}` : ""}`, { replace: true });
        } else
        {
            setErrorMessage(res.error || "Signup failed. Please try again.");
        }
    };

    const confirmMatch = confirmPassword.length > 0 && confirmPassword === password;
    const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

    return (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Success banner */}
            {isSuccess && (
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-semibold">Account created! Preparing your workspace...</span>
                </div>
            )}

            {/* Error banner */}
            {errorMessage && (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <span className="font-semibold">Registration failed:</span> {errorMessage}
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

            {/* Username field */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="signup-username" required>Username</Label>
                </div>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        <User className="h-4 w-4" />
                    </div>
                    <Input
                        id="signup-username"
                        type="text"
                        autoComplete="username"
                        disabled={isLoading || isSuccess}
                        placeholder="johndoe"
                        value={username}
                        onChange={e =>
                        {
                            setUsername(e.target.value);
                            if (fieldErrors.username) setFieldErrors(prev => ({ ...prev, username: undefined }));
                        }}
                        onBlur={handleBlurUsername}
                        className={`pl-9 ${fieldErrors.username ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    />
                </div>
                {fieldErrors.username && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        {fieldErrors.username}
                    </p>
                )}
            </div>

            {/* Email field */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="signup-email" required>Email address</Label>
                </div>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        <Mail className="h-4 w-4" />
                    </div>
                    <Input
                        id="signup-email"
                        type="email"
                        autoComplete="email"
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

            {/* Password field */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="signup-password" required>Password</Label>
                </div>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        <Lock className="h-4 w-4" />
                    </div>
                    <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        disabled={isLoading || isSuccess}
                        placeholder="Min 6 characters, uppercase & special"
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

            {/* Interactive Password Strength & Rules Checklist */}
            {password.length > 0 && (
                <PasswordStrengthMeter password={password} className="pt-1" />
            )}

            {/* Confirm Password field */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="signup-confirm-password" required>Confirm Password</Label>
                    {confirmMatch && (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Match
                        </span>
                    )}
                </div>
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" />
                    </div>
                    <Input
                        id="signup-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        disabled={isLoading || isSuccess}
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={e =>
                        {
                            setConfirmPassword(e.target.value);
                            if (fieldErrors.confirmPassword) setFieldErrors(prev => ({ ...prev, confirmPassword: undefined }));
                        }}
                        onBlur={handleBlurConfirmPassword}
                        className={`pl-9 pr-10 ${confirmMismatch || fieldErrors.confirmPassword
                            ? "border-destructive focus-visible:ring-destructive"
                            : confirmMatch
                                ? "border-emerald-500 focus-visible:ring-emerald-500"
                                : ""
                            }`}
                    />
                    <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
                    >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
                {fieldErrors.confirmPassword && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        {fieldErrors.confirmPassword}
                    </p>
                )}
            </div>

            {/* Agree to terms */}
            <div className="space-y-1 pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                    <input
                        type="checkbox"
                        checked={agreeTerms}
                        onChange={e =>
                        {
                            setAgreeTerms(e.target.checked);
                            if (fieldErrors.agreeTerms) setFieldErrors(prev => ({ ...prev, agreeTerms: undefined }));
                        }}
                        className="mt-0.5 rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    <span className="leading-tight">
                        I agree to the <span className="underline hover:text-foreground">Terms of Service</span> and acknowledge the <span className="underline hover:text-foreground">Privacy Policy</span>.
                    </span>
                </label>
                {fieldErrors.agreeTerms && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {fieldErrors.agreeTerms}
                    </p>
                )}
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
                        Creating account...
                    </span>
                ) : isSuccess ? (
                    <span className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Account ready!
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5">
                        Create Account
                        <ArrowRight className="h-4 w-4" />
                    </span>
                )}
            </Button>

            {/* Switch to Login link */}
            <div className="pt-2 text-center text-xs text-muted-foreground border-t border-border/50">
                Already have an account?{" "}
                <Link
                    to={`/login${redirectPath !== "/" ? `?redirect=${encodeURIComponent(redirectPath)}` : ""}`}
                    className="font-semibold text-primary hover:underline"
                >
                    Sign in here
                </Link>
            </div>
        </form>
    );
}
