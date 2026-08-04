import zod from "zod";

export const CreateOrgSchema = zod.object({
    name: zod.string().trim(),
    description: zod.string().trim(),
    visible: zod.preprocess((x) =>
        x == "true" ? true : x == "false" ? false : x,
        zod.boolean().optional().default(true)
    )
})
