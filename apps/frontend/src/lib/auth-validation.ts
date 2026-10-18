export interface PasswordRule
{
    id: string;
    label: string;
    met: boolean;
}

export interface PasswordEvaluation
{
    score: number; // 0 - 5
    strength: "none" | "very-weak" | "weak" | "fair" | "good" | "strong";
    rules: PasswordRule[];
    isValid: boolean;
}

export function evaluatePassword(password: string): PasswordEvaluation
{
    const trimmedPassword = password.trim();
    const rules: PasswordRule[] = [
        {
            id: "length",
            label: "6 to 20 characters",
            met: trimmedPassword.length >= 6 && trimmedPassword.length <= 20
        },
        {
            id: "uppercase",
            label: "At least one uppercase letter (A-Z)",
            met: /[A-Z]/.test(password)
        },
        {
            id: "lowercase",
            label: "At least one lowercase letter (a-z)",
            met: /[a-z]/.test(password)
        },
        {
            id: "number",
            label: "At least one number (0-9)",
            met: /[0-9]/.test(password)
        },
        {
            id: "special",
            label: "At least one special character (!@#$%...)",
            met: /[\W_]/.test(password)
        }
    ];

    const metCount = rules.filter(r => r.met).length;
    const isValid = metCount === rules.length;

    let strength: PasswordEvaluation["strength"] = "none";
    if (password.length > 0)
    {
        if (metCount <= 1) strength = "very-weak";
        else if (metCount === 2) strength = "weak";
        else if (metCount === 3) strength = "fair";
        else if (metCount === 4) strength = "good";
        else strength = "strong";
    }

    return {
        score: metCount,
        strength,
        rules,
        isValid
    };
}

export function validateEmail(email: string): { isValid: boolean; error?: string }
{
    const trimmed = email.trim();
    if (!trimmed)
    {
        return { isValid: false, error: "Email address is required" };
    }
    // Standard RFC 5322 compliant regex for basic web validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed))
    {
        return { isValid: false, error: "Please enter a valid email address" };
    }
    return { isValid: true };
}

export function validateUsername(username: string): { isValid: boolean; error?: string }
{
    const trimmed = username.trim();
    if (!trimmed)
    {
        return { isValid: false, error: "Username is required" };
    }
    if (trimmed.length < 1)
    {
        return { isValid: false, error: "Username is required" };
    }
    if (trimmed.length > 30)
    {
        return { isValid: false, error: "Username must be 30 characters or fewer" };
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed))
    {
        return { isValid: false, error: "Username may only contain letters, numbers, periods, hyphens, and underscores" };
    }
    return { isValid: true };
}

export function validateConfirmPassword(password: string, confirmPassword: string): { isValid: boolean; error?: string }
{
    if (!confirmPassword)
    {
        return { isValid: false, error: "Please confirm your password" };
    }
    if (password !== confirmPassword)
    {
        return { isValid: false, error: "Passwords do not match" };
    }
    return { isValid: true };
}

/**
 * Validates and sanitizes a redirect target URL to prevent open redirect vulnerabilities
 * and avoid infinite redirect loops to auth screens.
 */
export function getSafeRedirect(redirect: string | null | undefined): string
{
    if (!redirect) return "/";
    const trimmed = redirect.trim();

    // Disallow external URLs, protocol-relative URLs (//), and backslash-based open redirect vectors (/\evil.com)
    if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\"))
    {
        return "/";
    }

    // Must consist only of valid URL path/query/fragment characters without whitespace or control chars
    if (!/^\/[a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]*$/.test(trimmed))
    {
        return "/";
    }

    // Disallow redirect loops back to login or signup routes
    if (
        trimmed === "/login" ||
        trimmed.startsWith("/login?") ||
        trimmed.startsWith("/login/") ||
        trimmed === "/signup" ||
        trimmed.startsWith("/signup?") ||
        trimmed.startsWith("/signup/")
    )
    {
        return "/";
    }

    return trimmed;
}
