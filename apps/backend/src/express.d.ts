import express, { type Request, type Express } from "express";

declare global {
	namespace Express {
		interface Request {
			id: string,
			email: string
		}
	}
}
