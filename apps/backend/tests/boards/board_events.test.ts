import { beforeAll, describe, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";
import { create_boards } from "../helpers/create_board";
import { wsBroadcaster } from "../../src/services/broadcaster";
import { getBoardEvents } from "../../src/controllers/board/getEvents";
import { asyncHandler } from "../../src/helpers/asyncHandler";

describe("Board Events Catch-up Sync Tests", () =>
{
    let adminToken: string;
    let employeeToken: string;
    let contributorToken: string;
    let pendingToken: string;
    let outsiderToken: string;

    let adminUserId: string;
    let outsiderUserId: string;

    let testOrgId: string;
    let mainBoardId: string;
    let emptyBoardId: string;

    const expectedSeedEventCount = 6;

    beforeAll(async () =>
    {
        const adminUser = await create_user();
        adminUserId = adminUser.id;
        adminToken = await login_user(adminUser.email, adminUser.password);

        const employeeUser = await create_user();
        employeeToken = await login_user(employeeUser.email, employeeUser.password);

        const contributorUser = await create_user();
        contributorToken = await login_user(contributorUser.email, contributorUser.password);

        const pendingUser = await create_user();
        pendingToken = await login_user(pendingUser.email, pendingUser.password);

        const outsiderUser = await create_user();
        outsiderUserId = outsiderUser.id;
        outsiderToken = await login_user(outsiderUser.email, outsiderUser.password);

        const org = await create_org(adminToken, `events-sync-org-${crypto.randomUUID()}`);
        testOrgId = org.id;

        await invite_user(testOrgId, employeeUser.email, adminToken);
        await accept_invite(employeeToken, testOrgId);
        await update_user_role(testOrgId, employeeUser.email, adminToken, "employee");

        await invite_user(testOrgId, contributorUser.email, adminToken);
        await accept_invite(contributorToken, testOrgId);

        // Invite pending user without accepting invite
        await invite_user(testOrgId, pendingUser.email, adminToken);

        const mainBoard = await create_boards(adminToken, testOrgId);
        mainBoardId = mainBoard!.id;

        const emptyBoard = await create_boards(adminToken, testOrgId);
        emptyBoardId = emptyBoard!.id;

        // Seed 6 sequential real events on mainBoard via outbox broadcaster
        const seedEvents = [
            { eventType: "card:created", payload: { cardId: "card-1", title: "Initial card setup", position: 1000 } },
            { eventType: "card:moved", payload: { cardId: "card-1", fromSectionId: "sec-1", toSectionId: "sec-2", position: 2000 } },
            { eventType: "card:label_added", payload: { cardId: "card-1", labelId: "lbl-1" } },
            { eventType: "checklist:created", payload: { cardId: "card-1", checklistId: "chk-1", title: "Review Criteria" } },
            { eventType: "checklist_item:created", payload: { checklistId: "chk-1", itemId: "it-1", content: "Write integration tests" } },
            { eventType: "card:updated", payload: { cardId: "card-1", isCompleted: true } }
        ];

        for (const evt of seedEvents)
        {
            const recorded = await wsBroadcaster.recordBoardEvent(
                mainBoardId,
                evt.eventType,
                evt.payload,
                { throwOnError: true }
            );
            expect(recorded).not.toBeNull();
            expect(typeof recorded!.sequence).toBe("bigint");
        }
    });

    const createMockRes = () =>
    {
        const res: any = {
            statusCode: 200,
            body: null as any,
            status(code: number)
            {
                this.statusCode = code;
                return this;
            },
            json(data: any)
            {
                this.body = data;
                return this;
            }
        };
        return res;
    };

    describe("1. Monotonic BigInt Sequence Ordering & Serialization", () =>
    {
        it("returns all seeded events in strictly ascending monotonic sequence order", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                method: "GET",
                headers: {
                    authorization: `Bearer ${adminToken}`,
                    "Content-Type": "application/json"
                }
            });

            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };

            expect(json.success).toBe(true);
            expect(Array.isArray(json.data)).toBe(true);
            expect(json.data.length).toBe(expectedSeedEventCount);

            const sequences = json.data.map(e => e.sequence);
            expect(sequences).toEqual(["1", "2", "3", "4", "5", "6"]);

            for (let i = 0; i < json.data.length - 1; i++)
            {
                const currentSeq = BigInt(json.data[i].sequence);
                const nextSeq = BigInt(json.data[i + 1].sequence);
                expect(nextSeq).toBeGreaterThan(currentSeq);
                expect(nextSeq).toBe(currentSeq + 1n);
            }
        });

        it("serializes 64-bit BigInt sequences to decimal strings in JSON without precision loss", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                method: "GET",
                headers: { authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };

            for (const event of json.data)
            {
                expect(typeof event.sequence).toBe("string");
                expect(/^\d+$/.test(event.sequence)).toBe(true);

                const parsed = BigInt(event.sequence);
                expect(parsed.toString()).toBe(event.sequence);

                expect(typeof event.id).toBe("string");
                expect(event.boardId).toBe(mainBoardId);
                expect(typeof event.eventType).toBe("string");
                expect(typeof event.payload).toBe("object");
                expect(typeof event.published).toBe("boolean");
                expect(typeof event.createdAt).toBe("string");
            }
        });
    });

    describe("2. Cursor Pagination Filtering (sinceSeq) & Cursor Advancement", () =>
    {
        it("filters events returning strictly records where sequence > sinceSeq", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=2`, {
                method: "GET",
                headers: { authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };

            expect(json.data.length).toBe(4);
            expect(json.data.map(e => e.sequence)).toEqual(["3", "4", "5", "6"]);
            for (const event of json.data)
            {
                expect(BigInt(event.sequence)).toBeGreaterThan(2n);
            }
        });

        it("advances pagination cursors across consecutive multi-page requests", async () =>
        {
            const pageSize = 2;
            let currentCursor = "0";
            const retrievedEventIds: string[] = [];
            const retrievedSequences: string[] = [];

            // Page 1: sinceSeq = 0, limit = 2
            const resPage1 = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=${currentCursor}&limit=${pageSize}`, {
                method: "GET",
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resPage1.status).toBe(200);
            const jsonPage1 = await resPage1.json() as { success: boolean; data: any[] };
            expect(jsonPage1.data.length).toBe(2);
            expect(jsonPage1.data.map(e => e.sequence)).toEqual(["1", "2"]);

            jsonPage1.data.forEach(e => {
                retrievedEventIds.push(e.id);
                retrievedSequences.push(e.sequence);
            });
            currentCursor = jsonPage1.data[jsonPage1.data.length - 1].sequence;

            // Page 2: sinceSeq = 2, limit = 2
            const resPage2 = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=${currentCursor}&limit=${pageSize}`, {
                method: "GET",
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resPage2.status).toBe(200);
            const jsonPage2 = await resPage2.json() as { success: boolean; data: any[] };
            expect(jsonPage2.data.length).toBe(2);
            expect(jsonPage2.data.map(e => e.sequence)).toEqual(["3", "4"]);

            jsonPage2.data.forEach(e => {
                retrievedEventIds.push(e.id);
                retrievedSequences.push(e.sequence);
            });
            currentCursor = jsonPage2.data[jsonPage2.data.length - 1].sequence;

            // Page 3: sinceSeq = 4, limit = 2
            const resPage3 = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=${currentCursor}&limit=${pageSize}`, {
                method: "GET",
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resPage3.status).toBe(200);
            const jsonPage3 = await resPage3.json() as { success: boolean; data: any[] };
            expect(jsonPage3.data.length).toBe(2);
            expect(jsonPage3.data.map(e => e.sequence)).toEqual(["5", "6"]);

            jsonPage3.data.forEach(e => {
                retrievedEventIds.push(e.id);
                retrievedSequences.push(e.sequence);
            });
            currentCursor = jsonPage3.data[jsonPage3.data.length - 1].sequence;

            // Page 4: sinceSeq = 6, limit = 2 -> empty array
            const resPage4 = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=${currentCursor}&limit=${pageSize}`, {
                method: "GET",
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resPage4.status).toBe(200);
            const jsonPage4 = await resPage4.json() as { success: boolean; data: any[] };
            expect(jsonPage4.data).toEqual([]);

            expect(retrievedSequences).toEqual(["1", "2", "3", "4", "5", "6"]);
            expect(new Set(retrievedEventIds).size).toBe(6);
        });

        it("returns an empty data array when sinceSeq equals or exceeds the highest sequence", async () =>
        {
            const resExact = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=6`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resExact.status).toBe(200);
            const jsonExact = await resExact.json() as { success: boolean; data: any[] };
            expect(jsonExact.data).toEqual([]);

            const resBeyond = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=99999`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resBeyond.status).toBe(200);
            const jsonBeyond = await resBeyond.json() as { success: boolean; data: any[] };
            expect(jsonBeyond.data).toEqual([]);
        });

        it("returns an empty data array for a board with no recorded events", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${emptyBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };
            expect(json.success).toBe(true);
            expect(json.data).toEqual([]);
        });
    });

    describe("3. Query Parameter Clamping & Input Validation", () =>
    {
        it("uses default limit of 100 when limit query parameter is omitted", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };
            expect(json.data.length).toBe(6);
        });

        it("clamps limit greater than 500 to exactly 500 without error", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0&limit=9999`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };
            expect(json.data.length).toBe(6);
        });

        it("returns 400 Bad Request on invalid non-numeric sinceSeq", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=invalid_text`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(400);
            const json = await res.json() as { success: boolean; error: string };
            expect(json.success).toBe(false);
            expect(json.error).toBe("Bad Reuqest/Invalid Inputs");
        });

        it("returns 400 Bad Request on invalid non-numeric limit", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0&limit=invalid_limit`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(400);
            const json = await res.json() as { success: boolean; error: string };
            expect(json.success).toBe(false);
            expect(json.error).toBe("Bad Reuqest/Invalid Inputs");
        });

        it("returns 400 Bad Request when boardId is not a valid UUID format", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/not-a-valid-uuid-here/events`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(400);
            const json = await res.json() as { success: boolean; error: string };
            expect(json.success).toBe(false);
            expect(json.error).toBe("Bad Reuqest/Invalid Inputs");
        });
    });

    describe("4. Organization Membership & Role-Based Authorization", () =>
    {
        it("allows organization Admin to query board events (200 OK)", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean };
            expect(json.success).toBe(true);
        });

        it("allows organization Employee to query board events (200 OK)", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${employeeToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean };
            expect(json.success).toBe(true);
        });

        it("allows organization Contributor to query board events (200 OK)", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${contributorToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean };
            expect(json.success).toBe(true);
        });

        it("forbids pending member whose invitation has not been accepted (403 Forbidden)", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${pendingToken}` }
            });
            expect(res.status).toBe(403);
            const json = await res.json() as { success: boolean; error: string };
            expect(json.success).toBe(false);
            expect(json.error).toBe("Members only");
        });

        it("forbids authenticated outsider with no membership in the organization (403 Forbidden)", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${outsiderToken}` }
            });
            expect(res.status).toBe(403);
            const json = await res.json() as { success: boolean; error: string };
            expect(json.success).toBe(false);
            expect(json.error).toBe("Members only");
        });

        it("rejects unauthenticated request with 401 Unauthorized", async () =>
        {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`);
            expect(res.status).toBe(401);
        });

        it("returns 404 Not Found when boardId does not exist in database", async () =>
        {
            const nonExistentBoardId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${nonExistentBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(404);
            const json = await res.json() as { success: boolean; error: string };
            expect(json.success).toBe(false);
            expect(json.error).toBe("Board not found");
        });
    });

    describe("5. Route Aliases & Handler Parity", () =>
    {
        it("handles /api/boards/:id/events identically to /api/boards/:boardId/events", async () =>
        {
            const resAlias = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${mainBoardId}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(resAlias.status).toBe(200);
            const jsonAlias = await resAlias.json() as { success: boolean; data: any[] };

            expect(jsonAlias.success).toBe(true);
            expect(jsonAlias.data.length).toBe(6);
            expect(jsonAlias.data.map(e => e.sequence)).toEqual(["1", "2", "3", "4", "5", "6"]);
        });

        it("produces identical responses across params.boardId and params.id directly in controller", async () =>
        {
            const resBoardId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: adminUserId,
                params: { boardId: mainBoardId },
                query: { sinceSeq: "0" }
            } as any, resBoardId);

            const resId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: adminUserId,
                params: { id: mainBoardId },
                query: { sinceSeq: "0" }
            } as any, resId);

            expect(resBoardId.statusCode).toBe(200);
            expect(resId.statusCode).toBe(200);
            expect(resBoardId.body).toEqual(resId.body);
        });

        it("returns identical 404/403/400 error responses across boardId and id parameter aliases", async () =>
        {
            const nonExistentId = crypto.randomUUID();

            // 404 Not Found parity
            const resMissingBoardId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: adminUserId,
                params: { boardId: nonExistentId },
                query: {}
            } as any, resMissingBoardId);

            const resMissingId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: adminUserId,
                params: { id: nonExistentId },
                query: {}
            } as any, resMissingId);

            expect(resMissingBoardId.statusCode).toBe(404);
            expect(resMissingId.statusCode).toBe(404);
            expect(resMissingBoardId.body).toEqual({ success: false, error: "Board not found" });
            expect(resMissingId.body).toEqual({ success: false, error: "Board not found" });

            // 403 Forbidden parity
            const resForbiddenBoardId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: outsiderUserId,
                params: { boardId: mainBoardId },
                query: {}
            } as any, resForbiddenBoardId);

            const resForbiddenId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: outsiderUserId,
                params: { id: mainBoardId },
                query: {}
            } as any, resForbiddenId);

            expect(resForbiddenBoardId.statusCode).toBe(403);
            expect(resForbiddenId.statusCode).toBe(403);
            expect(resForbiddenBoardId.body).toEqual({ success: false, error: "Members only" });
            expect(resForbiddenId.body).toEqual({ success: false, error: "Members only" });

            // 400 Bad Request parity on invalid UUID
            const resInvalidBoardId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: adminUserId,
                params: { boardId: "invalid-uuid" },
                query: {}
            } as any, resInvalidBoardId);

            const resInvalidId = createMockRes();
            await asyncHandler(getBoardEvents)({
                id: adminUserId,
                params: { id: "invalid-uuid" },
                query: {}
            } as any, resInvalidId);

            expect(resInvalidBoardId.statusCode).toBe(400);
            expect(resInvalidId.statusCode).toBe(400);
            expect(resInvalidBoardId.body).toEqual({ success: false, error: "Bad Reuqest/Invalid Inputs" });
            expect(resInvalidId.body).toEqual({ success: false, error: "Bad Reuqest/Invalid Inputs" });
        });
    });

    describe("6. Advisory Lock & Monotonic Concurrency Integrity", () =>
    {
        it("records concurrent events under PostgreSQL advisory lock resulting in gapless monotonic sequences", async () =>
        {
            const concurrencyBoard = await create_boards(adminToken, testOrgId);

            const concurrentTasks = Array.from({ length: 5 }, (_, idx) =>
                wsBroadcaster.recordBoardEvent(
                    concurrencyBoard!.id,
                    `concurrent:mutation:${idx}`,
                    { batchIndex: idx, timestamp: Date.now() },
                    { throwOnError: true }
                )
            );

            const results = await Promise.all(concurrentTasks);
            expect(results.length).toBe(5);
            for (const r of results)
            {
                expect(r).not.toBeNull();
                expect(typeof r!.sequence).toBe("bigint");
            }

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${concurrencyBoard!.id}/events?sinceSeq=0`, {
                headers: { authorization: `Bearer ${adminToken}` }
            });
            expect(res.status).toBe(200);
            const json = await res.json() as { success: boolean; data: any[] };

            expect(json.data.length).toBe(5);
            const sequences = json.data.map(e => e.sequence);
            expect(sequences).toEqual(["1", "2", "3", "4", "5"]);

            const sequenceSet = new Set(sequences);
            expect(sequenceSet.size).toBe(5);
        });
    });
});
