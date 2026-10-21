import jwt, { type Secret } from "jsonwebtoken";
import { env } from "../env";
const secret = env.jwt_key as Secret;


export function token(email: string, id: string, name?: string | null, username?: string | null)
{
    const payload: { email: string; id: string; name?: string; username?: string } = {
        email: email,
        id: id
    };

    const cleanName = (name && typeof name === "string" && !name.includes("@"))
        ? name.trim()
        : (username && typeof username === "string" && !username.includes("@")
            ? username.trim()
            : (email && typeof email === "string" && email.includes("@") ? email.split("@")[0] : undefined));

    if (cleanName)
    {
        payload.name = cleanName;
    }
    if (username && typeof username === "string")
    {
        payload.username = username.trim();
    }
    const token = jwt.sign(payload, secret, { expiresIn: "7d" });
    return token;
}
