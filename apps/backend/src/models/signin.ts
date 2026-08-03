import zod from "zod";

export const SigninSchema = zod.object({
    email: zod.email(),
    password: zod.string()
        .min(6, "Minimum 8 characters")
        .max(20, "Maximum 20 characters")
})