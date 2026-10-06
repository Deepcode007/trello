import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { prisma } from "db/prisma";
import { updateIssue } from "../../src/controllers/issues/updateIssue";
import { wsBroadcaster } from "../../src/services/broadcaster";

describe("updateIssue move vs edit broadcasting unit tests", () => {
    const validIssueId = "11111111-1111-4111-8111-111111111111";
    const validSourceSectionId = "22222222-2222-4222-8222-222222222222";
    const validDestSectionId = "33333333-3333-4333-8333-333333333333";
    const validBoardId = "44444444-4444-4444-8444-444444444444";
    const userId = "user-123";

    const origBroadcastCardMoved = wsBroadcaster.broadcastCardMoved;
    const origBroadcastCardUpdated = wsBroadcaster.broadcastCardUpdated;
    const origIssueFindUnique = prisma.issues.findUnique;
    const origSectionFindUnique = prisma.sections.findUnique;
    const origIssueUpdate = prisma.issues.update;

    let movedCalls: any[] = [];
    let updatedCalls: any[] = [];

    beforeEach(() => {
        movedCalls = [];
        updatedCalls = [];

        // Mock broadcaster methods
        wsBroadcaster.broadcastCardMoved = mock((boardId: string, payload: any) => {
            movedCalls.push({ boardId, payload });
            return Promise.resolve(true);
        }) as any;

        wsBroadcaster.broadcastCardUpdated = mock((boardId: string, cardId: string, updates: any) => {
            updatedCalls.push({ boardId, cardId, updates });
            return Promise.resolve(true);
        }) as any;

        // Mock Prisma queries
        prisma.issues.findUnique = mock((_args: any) => {
            return Promise.resolve({
                boardId: validBoardId,
                sectionId: validSourceSectionId,
                board: {
                    org: {
                        members: [
                            { userId, accepted: true, role: "admin" }
                        ]
                    }
                }
            });
        }) as any;

        prisma.sections.findUnique = mock((args: any) => {
            return Promise.resolve({
                id: args.where.id,
                boardId: validBoardId
            });
        }) as any;

        prisma.issues.update = mock((args: any) => {
            return Promise.resolve({
                id: args.where.id,
                boardId: validBoardId,
                sectionId: args.data.sectionId ?? validSourceSectionId,
                title: args.data.title ?? "Old Title",
                gh_url: args.data.gh_url ?? "https://github.com/old"
            });
        }) as any;
    });

    afterEach(() => {
        wsBroadcaster.broadcastCardMoved = origBroadcastCardMoved;
        wsBroadcaster.broadcastCardUpdated = origBroadcastCardUpdated;
        prisma.issues.findUnique = origIssueFindUnique;
        prisma.sections.findUnique = origSectionFindUnique;
        prisma.issues.update = origIssueUpdate;
    });

    function createMockReqRes(body: Record<string, any>, path = "") {
        const req: any = {
            id: userId,
            params: { issueId: validIssueId },
            body,
            path
        };
        let responseJson: any = null;
        let responseStatus = 200;
        const res: any = {
            status: mock((s: number) => {
                responseStatus = s;
                return res;
            }),
            json: mock((j: any) => {
                responseJson = j;
                return res;
            }),
            getStatus: () => responseStatus,
            getJson: () => responseJson
        };
        return { req, res };
    }

    it("pure move (position change) broadcasts ONLY card:moved", async () => {
        const { req, res } = createMockReqRes({ position: 2 });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(1);
        expect(movedCalls[0].boardId).toBe(validBoardId);
        expect(movedCalls[0].payload.cardId).toBe(validIssueId);
        expect(movedCalls[0].payload.position).toBe(2);

        expect(updatedCalls.length).toBe(0);
    });

    it("pure move (cross-section move) broadcasts ONLY card:moved", async () => {
        const { req, res } = createMockReqRes({ sectionId: validDestSectionId });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(1);
        expect(movedCalls[0].boardId).toBe(validBoardId);
        expect(movedCalls[0].payload.cardId).toBe(validIssueId);
        expect(movedCalls[0].payload.sourceList).toBe(validSourceSectionId);
        expect(movedCalls[0].payload.destList).toBe(validDestSectionId);

        expect(updatedCalls.length).toBe(0);
    });

    it("pure edit (title change) broadcasts ONLY card:updated", async () => {
        const { req, res } = createMockReqRes({ title: "New Issue Title" });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].boardId).toBe(validBoardId);
        expect(updatedCalls[0].cardId).toBe(validIssueId);
        expect(updatedCalls[0].updates).toEqual({ title: "New Issue Title" });

        expect(movedCalls.length).toBe(0);
    });

    it("pure edit (gh_url change) broadcasts ONLY card:updated", async () => {
        const { req, res } = createMockReqRes({ gh_url: "https://github.com/new" });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].boardId).toBe(validBoardId);
        expect(updatedCalls[0].cardId).toBe(validIssueId);
        expect(updatedCalls[0].updates).toEqual({ gh_url: "https://github.com/new" });

        expect(movedCalls.length).toBe(0);
    });

    it("dual change (move + title edit) broadcasts BOTH card:moved and card:updated", async () => {
        const { req, res } = createMockReqRes({
            position: 3,
            sectionId: validDestSectionId,
            title: "Moved and Renamed"
        });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);

        // Both events broadcasted
        expect(movedCalls.length).toBe(1);
        expect(movedCalls[0].payload.cardId).toBe(validIssueId);
        expect(movedCalls[0].payload.sourceList).toBe(validSourceSectionId);
        expect(movedCalls[0].payload.destList).toBe(validDestSectionId);
        expect(movedCalls[0].payload.position).toBe(3);

        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].cardId).toBe(validIssueId);
        expect(updatedCalls[0].updates).toEqual({ title: "Moved and Renamed" });
    });

    it("dual change (move via /move path + gh_url edit) broadcasts BOTH events", async () => {
        const { req, res } = createMockReqRes({
            gh_url: "https://github.com/dual"
        }, "/api/cards/11111111-1111-4111-8111-111111111111/move");
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(1);
        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].updates).toEqual({ gh_url: "https://github.com/dual" });
    });

    it("empty update broadcasts neither event", async () => {
        const { req, res } = createMockReqRes({});
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(0);
        expect(updatedCalls.length).toBe(0);
    });

    it("same section specified with title edit broadcasts ONLY card:updated (not card:moved)", async () => {
        const { req, res } = createMockReqRes({
            sectionId: validSourceSectionId,
            title: "Updated in Same Section"
        });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(0);
        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].updates).toEqual({ title: "Updated in Same Section" });
    });

    it("same section specified with position change AND title edit broadcasts BOTH card:moved and card:updated", async () => {
        const { req, res } = createMockReqRes({
            sectionId: validSourceSectionId,
            position: 5,
            title: "Reordered and Renamed"
        });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(1);
        expect(movedCalls[0].payload.sourceList).toBe(validSourceSectionId);
        expect(movedCalls[0].payload.destList).toBe(validSourceSectionId);
        expect(movedCalls[0].payload.position).toBe(5);

        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].updates).toEqual({ title: "Reordered and Renamed" });
    });

    it("dual change with cross-section move AND both title and gh_url edit broadcasts BOTH events with complete updates", async () => {
        const { req, res } = createMockReqRes({
            destList: validDestSectionId,
            position: 1,
            title: "Complete Change",
            gh_url: "https://github.com/full"
        });
        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(1);
        expect(movedCalls[0].payload.sourceList).toBe(validSourceSectionId);
        expect(movedCalls[0].payload.destList).toBe(validDestSectionId);
        expect(movedCalls[0].payload.position).toBe(1);

        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].updates).toEqual({
            title: "Complete Change",
            gh_url: "https://github.com/full"
        });
    });

    it("move detected via req.originalUrl when path is empty broadcasts card:moved", async () => {
        const req: any = {
            id: userId,
            params: { issueId: validIssueId },
            body: { title: "Dual from originalUrl" },
            originalUrl: `/api/cards/${validIssueId}/move`
        };
        let responseStatus = 200;
        const res: any = {
            status: mock((s: number) => {
                responseStatus = s;
                return res;
            }),
            json: mock(() => res),
            getStatus: () => responseStatus
        };

        await updateIssue(req, res);

        expect(res.getStatus()).toBe(200);
        expect(movedCalls.length).toBe(1);
        expect(updatedCalls.length).toBe(1);
        expect(updatedCalls[0].updates).toEqual({ title: "Dual from originalUrl" });
    });
});
