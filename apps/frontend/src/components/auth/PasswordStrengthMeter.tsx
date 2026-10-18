import React from "react";
import { Check, X } from "lucide-react";
import { evaluatePassword, type PasswordEvaluation } from "../../lib/auth-validation";
import { cn } from "../../lib/utils";

interface PasswordStrengthMeterProps
{
    password: string;
    showRules?: boolean;
    className?: string;
}

export function PasswordStrengthMeter({
    password,
    showRules = true,
    className
}: PasswordStrengthMeterProps)
{
    const evaluation: PasswordEvaluation = evaluatePassword(password);
    const { score, strength, rules } = evaluation;

    const strengthDetails: Record<
        PasswordEvaluation["strength"],
        { text: string; colorClass: string; barBg: string }
    > = {
        none: { text: "No password", colorClass: "text-muted-foreground", barBg: "bg-muted" },
        "very-weak": { text: "Too weak", colorClass: "text-destructive", barBg: "bg-destructive" },
        weak: { text: "Weak", colorClass: "text-amber-500", barBg: "bg-amber-500" },
        fair: { text: "Fair", colorClass: "text-amber-500", barBg: "bg-amber-500" },
        good: { text: "Good", colorClass: "text-blue-500", barBg: "bg-blue-500" },
        strong: { text: "Strong", colorClass: "text-emerald-500", barBg: "bg-emerald-500" }
    };

    const current = strengthDetails[strength];

    return (
        <div className={cn("space-y-3", className)}>
            {/* Progress bar and label */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">Password strength</span>
                    <span className={cn("font-semibold transition-colors duration-200", current.colorClass)}>
                        {current.text}
                    </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    {[1, 2, 3, 4, 5].map(step =>
                    {
                        const isFilled = score >= step;
                        return (
                            <div
                                key={step}
                                className={cn(
                                    "h-full rounded-full transition-all duration-300",
                                    isFilled ? current.barBg : "bg-muted"
                                )}
                            />
                        );
                    })}
                </div>
            </div>

            {/* Rules checklist */}
            {showRules && (
                <div className="rounded-lg border bg-card/60 p-3 text-xs space-y-1.5">
                    <div className="font-semibold text-card-foreground text-xs pb-1 border-b border-border/50">
                        Requirements:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                        {rules.map(rule => (
                            <div
                                key={rule.id}
                                className={cn(
                                    "flex items-center gap-1.5 transition-colors duration-200",
                                    rule.met ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"
                                )}
                            >
                                {rule.met ? (
                                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                    <X className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
                                )}
                                <span>{rule.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
