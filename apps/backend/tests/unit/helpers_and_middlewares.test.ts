import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import { buildCommentTree } from "../../src/helpers/commentTree";
import {
    AppError,
    ValidationError,
    Unauthorised,
    Forbidden,
    Not_Found,
    Duplicate,
    Rate_Limit
} from "../../src/helpers/errorClass";
import { asyncHandler } from "../../src/helpers/asyncHandler";
import { token } from "../../src/middlewares/token";
import { auth } from "../../src/middlewares/auth";
import { SigninSchema } from "../../src/models/signin";
import { SignupSchema } from "../../src/models/signup";
import { CreateOrgSchema } from "../../src/models/create_org";
import { UpdateOrgSchema } from "../../src/models/update_org";
import { envSchema } from "../../src/types/env";
import type { CommentsWithoutBoard } from "../../src/types/comment";

describe("Helpers, Middlewares, and Models Tests", () =>
{
    describe("buildCommentTree helper", () =>
    {
        it("returns empty array for empty comment list", () =>
        {
            const result = buildCommentTree([]);
            expect(result).toEqual([]);
        });

        it("builds multi-level comment tree with root and replies", () =>
        {
            const flatComments: CommentsWithoutBoard = [
                {
                    id: "c1",
                    description: "Root 1",
                    parentId: null,
                    createdAt: new Date(),
                    user: { username: "alice" },
                    issue: { id: "i1", title: "Issue 1" }
                },
                {
                    id: "c2",
                    description: "Reply to Root 1",
                    parentId: "c1",
                    createdAt: new Date(),
                    user: { username: "bob" },
                    issue: { id: "i1", title: "Issue 1" }
                },
                {
                    id: "c3",
                    description: "Reply to Reply c2",
                    parentId: "c2",
                    createdAt: new Date(),
                    user: { username: "charlie" },
                    issue: { id: "i1", title: "Issue 1" }
                },
                {
                    id: "c4",
                    description: "Root 2",
                    parentId: null,
                    createdAt: new Date(),
                    user: { username: "david" },
                    issue: { id: "i1", title: "Issue 1" }
                }
            ];

            const tree = buildCommentTree(flatComments);
            expect(tree.length).toBe(2); // Two roots: c1, c4
            expect(tree[0]!.id).toBe("c1");
            expect(tree[0]!.children.length).toBe(1);
            expect(tree[0]!.children[0]!.id).toBe("c2");
            expect(tree[0]!.children[0]!.children.length).toBe(1);
            expect(tree[0]!.children[0]!.children[0]!.id).toBe("c3");
            expect(tree[1]!.id).toBe("c4");
            expect(tree[1]!.children.length).toBe(0);
        });

        it("handles orphan comments gracefully by treating them as roots", () =>
        {
            const flatComments: CommentsWithoutBoard = [
                {
                    id: "c1",
                    description: "Orphan Comment",
                    parentId: "non-existent-parent",
                    createdAt: new Date(),
                    user: { username: "alice" },
                    issue: { id: "i1", title: "Issue 1" }
                }
            ];

            const tree = buildCommentTree(flatComments);
            expect(tree.length).toBe(1);
            expect(tree[0]!.id).toBe("c1");
        });
    });

    describe("Error classes", () =>
    {
        it("instantiates AppError with defaults and custom values", () =>
        {
            const defaultErr = new AppError();
            expect(defaultErr.statusCode).toBe(500);
            expect(defaultErr.message).toBe("Internal Server Error");

            const customErr = new AppError(503, "Service Unavailable");
            expect(customErr.statusCode).toBe(503);
            expect(customErr.message).toBe("Service Unavailable");
        });

        it("instantiates ValidationError with 400 status", () =>
        {
            const err = new ValidationError("Invalid field");
            expect(err.statusCode).toBe(400);
            expect(err.message).toBe("Invalid field");

            const defaultErr = new ValidationError();
            expect(defaultErr.statusCode).toBe(400);
            expect(defaultErr.message).toBe("Bad Reuqest/Invalid Inputs");
        });

        it("instantiates Unauthorised with 401 status", () =>
        {
            const err = new Unauthorised("Token expired");
            expect(err.statusCode).toBe(401);
            expect(err.message).toBe("Token expired");

            const defaultErr = new Unauthorised();
            expect(defaultErr.statusCode).toBe(401);
        });

        it("instantiates Forbidden with 403 status", () =>
        {
            const err = new Forbidden("No access");
            expect(err.statusCode).toBe(403);
            expect(err.message).toBe("No access");

            const defaultErr = new Forbidden();
            expect(defaultErr.statusCode).toBe(403);
        });

        it("instantiates Not_Found with 404 status", () =>
        {
            const err = new Not_Found("Resource not found");
            expect(err.statusCode).toBe(404);
            expect(err.message).toBe("Resource not found");

            const defaultErr = new Not_Found();
            expect(defaultErr.statusCode).toBe(404);
        });

        it("instantiates Duplicate with 409 status", () =>
        {
            const err = new Duplicate("Already exists");
            expect(err.statusCode).toBe(409);
            expect(err.message).toBe("Already exists");

            const defaultErr = new Duplicate();
            expect(defaultErr.statusCode).toBe(409);
        });

        it("instantiates Rate_Limit with 429 status", () =>
        {
            const err = new Rate_Limit("Slow down");
            expect(err.statusCode).toBe(429);
            expect(err.message).toBe("Slow down");

            const defaultErr = new Rate_Limit();
            expect(defaultErr.statusCode).toBe(429);
        });
    });

    describe("asyncHandler wrapper", () =>
    {
        it("catches AppError and responds with custom status and json error", async () =>
        {
            let capturedStatus = 0;
            let capturedJson: any = null;

            const res = {
                status: (code: number) =>
                {
                    capturedStatus = code;
                    return {
                        json: (data: any) => { capturedJson = data; }
                    };
                }
            } as any;

            const handler = asyncHandler(async () =>
            {
                throw new Forbidden("Access denied for test");
            });

            await handler({} as any, res);

            expect(capturedStatus).toBe(403);
            expect(capturedJson).toEqual({
                success: false,
                error: "Access denied for test"
            });
        });

        it("catches generic unexpected Error and responds with 500", async () =>
        {
            let capturedStatus = 0;
            let capturedJson: any = null;

            const res = {
                status: (code: number) =>
                {
                    capturedStatus = code;
                    return {
                        json: (data: any) => { capturedJson = data; }
                    };
                }
            } as any;

            const handler = asyncHandler(async () =>
            {
                throw new Error("Unexpected crash");
            });

            await handler({} as any, res);

            expect(capturedStatus).toBe(500);
            expect(capturedJson).toEqual({
                success: false,
                error: "Some Server Error"
            });
        });
    });

    describe("Auth and Token middleware", () =>
    {
        it("generates a valid JWT token that auth middleware accepts", async () =>
        {
            const userEmail = "test@example.com";
            const userId = crypto.randomUUID();
            const jwtToken = token(userEmail, userId);

            expect(typeof jwtToken).toBe("string");

            let nextCalled = false;
            const req = {
                headers: { authorization: `Bearer ${jwtToken}` }
            } as any;
            const res = {} as any;

            auth(req, res, () => { nextCalled = true; });

            expect(nextCalled).toBe(true);
            expect(req.id).toBe(userId);
            expect(req.email).toBe(userEmail);
        });

        it("returns 401 when authorization header is missing", () =>
        {
            let capturedStatus = 0;
            let capturedJson: any = null;
            const res = {
                status: (code: number) =>
                {
                    capturedStatus = code;
                    return {
                        json: (data: any) => { capturedJson = data; }
                    };
                }
            } as any;

            const req = { headers: {} } as any;

            auth(req, res, () => {});

            expect(capturedStatus).toBe(401);
            expect(capturedJson.error).toBe("User unauthorised");
        });

        it("returns 401 when authorization scheme is not Bearer", () =>
        {
            const jwtToken = token("test@example.com", crypto.randomUUID());
            let capturedStatus = 0;
            const res = {
                status: (code: number) =>
                {
                    capturedStatus = code;
                    return { json: () => {} };
                }
            } as any;

            let nextCalled = false;
            auth({ headers: { authorization: `Basic ${jwtToken}` } } as any, res, () => { nextCalled = true; });

            expect(capturedStatus).toBe(401);
            expect(nextCalled).toBe(false);
        });

        it("issues tokens that carry an expiry", () =>
        {
            const decoded = jwt.decode(token("test@example.com", crypto.randomUUID())) as { exp?: number; iat: number };
            expect(decoded.exp).toBeDefined();
            expect(decoded.exp!).toBeGreaterThan(decoded.iat);
        });

        it("returns 401 when token is invalid or malformed", () =>
        {
            let capturedStatus = 0;
            let capturedJson: any = null;
            const res = {
                status: (code: number) =>
                {
                    capturedStatus = code;
                    return {
                        json: (data: any) => { capturedJson = data; }
                    };
                }
            } as any;

            const req = { headers: { authorization: "Bearer invalid.jwt.token" } } as any;

            auth(req, res, () => {});

            expect(capturedStatus).toBe(401);
            expect(capturedJson.error).toBe("User unauthorised");
        });
    });

    describe("Zod validation schemas", () =>
    {
        it("validates SigninSchema", () =>
        {
            expect(SigninSchema.safeParse({ email: "user@example.com", password: "password123" }).success).toBe(true);
            expect(SigninSchema.safeParse({ email: "invalid-email", password: "password123" }).success).toBe(false);
            expect(SigninSchema.safeParse({ email: "user@example.com", password: "123" }).success).toBe(false); // < 6 chars
        });

        it("validates SignupSchema", () =>
        {
            expect(SignupSchema.safeParse({
                email: "user@example.com",
                password: "Password123!",
                username: "alice"
            }).success).toBe(true);

            // missing special char
            expect(SignupSchema.safeParse({
                email: "user@example.com",
                password: "Password123",
                username: "alice"
            }).success).toBe(false);

            // missing uppercase
            expect(SignupSchema.safeParse({
                email: "user@example.com",
                password: "password123!",
                username: "alice"
            }).success).toBe(false);

            // missing username
            expect(SignupSchema.safeParse({
                email: "user@example.com",
                password: "Password123!",
                username: ""
            }).success).toBe(false);
        });

        it("validates CreateOrgSchema", () =>
        {
            const valid = CreateOrgSchema.safeParse({
                name: "My Org",
                description: "Description",
                visible: "false"
            });
            expect(valid.success).toBe(true);
            if (valid.success)
            {
                expect(valid.data.visible).toBe(false);
            }

            const defaultVisible = CreateOrgSchema.safeParse({
                name: "My Org",
                description: "Description"
            });
            expect(defaultVisible.success).toBe(true);
            if (defaultVisible.success)
            {
                expect(defaultVisible.data.visible).toBe(true);
            }
        });

        it("validates UpdateOrgSchema", () =>
        {
            expect(UpdateOrgSchema.safeParse({ name: "Updated" }).success).toBe(true);
            expect(UpdateOrgSchema.safeParse({ visible: false }).success).toBe(true);
            expect(UpdateOrgSchema.safeParse({}).success).toBe(true);
        });

        it("validates envSchema", () =>
        {
            expect(envSchema.safeParse({ port: "3000", jwt_key: "mysecret" }).success).toBe(true);
            expect(envSchema.safeParse({ port: "not-a-number", jwt_key: "mysecret" }).success).toBe(false);
            expect(envSchema.safeParse({ port: "3000" }).success).toBe(false);
        });
    });
});
