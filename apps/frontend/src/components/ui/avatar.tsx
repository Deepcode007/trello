import * as React from "react";
import { cn } from "../../lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: string;
  email?: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}

function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(" ");
    const p0 = parts[0];
    const p1 = parts[1];
    if (parts.length >= 2 && p0 && p1 && p0[0] && p1[0]) {
      return (p0[0] + p1[0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email && email.trim()) {
    return email.slice(0, 2).toUpperCase();
  }
  return "?";
}

function getColor(seed: string): string {
  const colors = [
    "bg-red-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-blue-500",
    "bg-indigo-500",
    "bg-violet-500",
    "bg-pink-500",
    "bg-teal-500"
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index] || "bg-blue-500";
}

export function Avatar({ name, email, src, size = "md", className, ...props }: AvatarProps) {
  const [imgError, setImgError] = React.useState(false);

  const sizeClasses = {
    sm: "h-6 w-6 text-xs",
    md: "h-8 w-8 text-xs font-medium",
    lg: "h-10 w-10 text-sm font-medium"
  };

  const seed = email || name || "user";
  const initials = getInitials(name, email);
  const bgColor = getColor(seed);

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white shadow-sm ring-1 ring-white/10",
        sizeClasses[size],
        bgColor,
        className
      )}
      title={name || email}
      {...props}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={name || email || "Avatar"}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
