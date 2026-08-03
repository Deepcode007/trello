import zod from "zod";

export const SignupSchema = zod.object({
    email: zod.email(),
    password: zod.string()
        .min(6, "Minimum 8 characters")
        .max(20, "Maximum 20 characters")
        .regex(/[A-Z]/, "Requires one uppercase letter")
        .regex(/[a-z]/, "Requires one lowercase letter")
        .regex(/[0-9]/, "Requires one number")
        .regex(/[\W_]/, "Requires one special character"),
    name: zod.string()
})