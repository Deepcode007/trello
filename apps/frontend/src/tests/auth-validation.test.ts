import { describe, it, expect } from "bun:test";
import
{
    evaluatePassword,
    validateEmail,
    validateUsername,
    validateConfirmPassword,
    getSafeRedirect
} from "../lib/auth-validation";

describe("auth-validation", () =>
{
    describe("evaluatePassword", () =>
    {
        it("handles empty password", () =>
        {
            const result = evaluatePassword("");
            expect(result.score).toBe(0);
            expect(result.strength).toBe("none");
            expect(result.isValid).toBe(false);
            expect(result.rules.every(r => !r.met)).toBe(true);
        });

        it("rejects password shorter than 6 characters even if all character classes present", () =>
        {
            const result = evaluatePassword("Aa1!"); // length 4
            expect(result.isValid).toBe(false);
            const lengthRule = result.rules.find(r => r.id === "length");
            expect(lengthRule?.met).toBe(false);
        });

        it("rejects password longer than 20 characters", () =>
        {
            const result = evaluatePassword("A1!aLongPasswordThatExceedsTwentyChars");
            expect(result.isValid).toBe(false);
            const lengthRule = result.rules.find(r => r.id === "length");
            expect(lengthRule?.met).toBe(false);
        });

        it("validates boundary lengths 6 and 20", () =>
        {
            const len6 = evaluatePassword("Aa1!bc"); // 6 chars
            expect(len6.isValid).toBe(true);
            expect(len6.rules.find(r => r.id === "length")?.met).toBe(true);

            const len20 = evaluatePassword("Aa1!bcdefghijklmnopq"); // 20 chars
            expect(len20.isValid).toBe(true);
            expect(len20.rules.find(r => r.id === "length")?.met).toBe(true);
        });

        it("correctly identifies missing character classes", () =>
        {
            // Missing uppercase
            const noUpper = evaluatePassword("password123!");
            expect(noUpper.rules.find(r => r.id === "uppercase")?.met).toBe(false);
            expect(noUpper.isValid).toBe(false);

            // Missing lowercase
            const noLower = evaluatePassword("PASSWORD123!");
            expect(noLower.rules.find(r => r.id === "lowercase")?.met).toBe(false);
            expect(noLower.isValid).toBe(false);

            // Missing number
            const noNumber = evaluatePassword("Password!!!!");
            expect(noNumber.rules.find(r => r.id === "number")?.met).toBe(false);
            expect(noNumber.isValid).toBe(false);

            // Missing special char
            const noSpecial = evaluatePassword("Password123");
            expect(noSpecial.rules.find(r => r.id === "special")?.met).toBe(false);
            expect(noSpecial.isValid).toBe(false);
        });

        it("accepts valid passwords meeting all criteria", () =>
        {
            const valid = evaluatePassword("StrongPass1!");
            expect(valid.score).toBe(5);
            expect(valid.strength).toBe("strong");
            expect(valid.isValid).toBe(true);
            expect(valid.rules.every(r => r.met)).toBe(true);
        });

        it("treats underscore as special character matching backend schema [\\W_]", () =>
        {
            const withUnderscore = evaluatePassword("Password_123");
            const specialRule = withUnderscore.rules.find(r => r.id === "special");
            expect(specialRule?.met).toBe(true);
            expect(withUnderscore.isValid).toBe(true);
        });

        it("evaluates trimmed password length correctly", () =>
        {
            // Raw length 10, but trimmed is 4 -> should fail length rule
            const withSpaces = evaluatePassword("   Aa1!   ");
            expect(withSpaces.isValid).toBe(false);
            expect(withSpaces.rules.find(r => r.id === "length")?.met).toBe(false);

            // Valid password with leading/trailing spaces
            const validWithSpaces = evaluatePassword("  StrongPass1!  ");
            expect(validWithSpaces.isValid).toBe(true);
            expect(validWithSpaces.rules.find(r => r.id === "length")?.met).toBe(true);
        });
    });

    describe("validateEmail", () =>
    {
        it("rejects empty or whitespace email", () =>
        {
            expect(validateEmail("").isValid).toBe(false);
            expect(validateEmail("   ").isValid).toBe(false);
        });

        it("rejects malformed email formats", () =>
        {
            expect(validateEmail("notanemail").isValid).toBe(false);
            expect(validateEmail("@example.com").isValid).toBe(false);
            expect(validateEmail("user@").isValid).toBe(false);
            expect(validateEmail("user@domain").isValid).toBe(false);
        });

        it("accepts valid email addresses", () =>
        {
            expect(validateEmail("user@example.com").isValid).toBe(true);
            expect(validateEmail("john.doe+work@sub.domain.co").isValid).toBe(true);
        });
    });

    describe("validateUsername", () =>
    {
        it("rejects empty or whitespace username", () =>
        {
            expect(validateUsername("").isValid).toBe(false);
            expect(validateUsername("   ").isValid).toBe(false);
        });

        it("accepts 1 character username matching backend min(1)", () =>
        {
            expect(validateUsername("a").isValid).toBe(true);
            expect(validateUsername("x").isValid).toBe(true);
        });

        it("rejects username with invalid characters", () =>
        {
            expect(validateUsername("john doe").isValid).toBe(false);
            expect(validateUsername("john@doe").isValid).toBe(false);
            expect(validateUsername("user#123").isValid).toBe(false);
        });

        it("accepts valid usernames with alphanumeric, dots, hyphens, and underscores", () =>
        {
            expect(validateUsername("johndoe").isValid).toBe(true);
            expect(validateUsername("john.doe").isValid).toBe(true);
            expect(validateUsername("john-doe").isValid).toBe(true);
            expect(validateUsername("john_doe_99").isValid).toBe(true);
        });
    });

    describe("validateConfirmPassword", () =>
    {
        it("rejects empty confirmation", () =>
        {
            expect(validateConfirmPassword("Password123!", "").isValid).toBe(false);
        });

        it("rejects mismatched passwords", () =>
        {
            expect(validateConfirmPassword("Password123!", "Password123?").isValid).toBe(false);
        });

        it("accepts matching passwords", () =>
        {
            expect(validateConfirmPassword("Password123!", "Password123!").isValid).toBe(true);
        });
    });

    describe("getSafeRedirect", () =>
    {
        it("defaults to / when empty, null, or undefined", () =>
        {
            expect(getSafeRedirect(null)).toBe("/");
            expect(getSafeRedirect(undefined)).toBe("/");
            expect(getSafeRedirect("")).toBe("/");
            expect(getSafeRedirect("   ")).toBe("/");
        });

        it("preserves valid relative paths", () =>
        {
            expect(getSafeRedirect("/boards/123")).toBe("/boards/123");
            expect(getSafeRedirect("/orgs/1/boards/2?tab=activity")).toBe("/orgs/1/boards/2?tab=activity");
        });

        it("neutralizes protocol-relative, javascript, or external URLs", () =>
        {
            expect(getSafeRedirect("https://evil.com")).toBe("/");
            expect(getSafeRedirect("http://evil.com")).toBe("/");
            expect(getSafeRedirect("//evil.com")).toBe("/");
            expect(getSafeRedirect("javascript:alert(1)")).toBe("/");
        });

        it("neutralizes backslash-based open redirect exploits", () =>
        {
            expect(getSafeRedirect("/\\evil.com")).toBe("/");
            expect(getSafeRedirect("\\evil.com")).toBe("/");
            expect(getSafeRedirect("/\\/\\evil.com")).toBe("/");
            expect(getSafeRedirect("/path\\with\\backslash")).toBe("/");
        });

        it("neutralizes whitespace and control characters in redirect target", () =>
        {
            expect(getSafeRedirect("/ with-space")).toBe("/");
            expect(getSafeRedirect("/tab\tcharacter")).toBe("/");
            expect(getSafeRedirect("/newline\ninpath")).toBe("/");
        });

        it("prevents redirect loops back to auth routes while preserving non-auth prefix paths", () =>
        {
            expect(getSafeRedirect("/login")).toBe("/");
            expect(getSafeRedirect("/login?redirect=/dashboard")).toBe("/");
            expect(getSafeRedirect("/login/callback")).toBe("/");
            expect(getSafeRedirect("/signup")).toBe("/");
            expect(getSafeRedirect("/signup?redirect=/boards/1")).toBe("/");
            expect(getSafeRedirect("/signup/invite")).toBe("/");
            // Legitimate distinct routes sharing a prefix should NOT be blocked
            expect(getSafeRedirect("/logins")).toBe("/logins");
            expect(getSafeRedirect("/signup-welcome")).toBe("/signup-welcome");
        });
    });
});
