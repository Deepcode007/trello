import jwt, { type Secret } from "jsonwebtoken";
import { env } from "../..";
const secret = env.jwt_key as Secret;


export function token(email: string, id: string) {
	const token = jwt.sign({
		email: email,
		id: id
	}, secret);
	return token;
}