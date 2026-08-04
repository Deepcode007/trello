import zod from "zod";

export const UpdateOrgSchema = zod.object({
    name: zod.string().trim().optional(),
    description: zod.string().trim().optional()
})
