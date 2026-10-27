import { describe, expect, it, mock } from "bun:test";
import { parseMentions, validateMentions } from "../../src/helpers/mentions";

describe("Mention Parser & Validator Helper Tests", () => {
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const userC = "33333333-3333-4333-8333-333333333333";
    const userPending = "44444444-4444-4444-8444-444444444444";
    const userNonExistent = "99999999-9999-4999-8999-999999999999";
    const authorId = "00000000-0000-4000-8000-000000000000";
    const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    describe("parseMentions()", () => {
        it("extracts valid mention markup from text", () => {
            const text = `Hello @[Alice Smith](user:${userA}), please review this PR.`;
            const mentions = parseMentions(text);

            expect(mentions).toHaveLength(1);
            expect(mentions[0]).toEqual({
                displayName: "Alice Smith",
                userId: userA
            });
        });

        it("returns empty array for text with no mentions", () => {
            expect(parseMentions("Hello world, no mentions here!")).toEqual([]);
            expect(parseMentions("")).toEqual([]);
            expect(parseMentions(null as any)).toEqual([]);
            expect(parseMentions(undefined as any)).toEqual([]);
        });

        it("handles malformed mention markup gracefully", () => {
            const malformed = "Hey @[Incomplete(user:123) and @[Empty]() and @[no-id](user:) and @Alice";
            const result = parseMentions(malformed);
            expect(result).toEqual([]);
        });

        it("deduplicates same userId mentioned multiple times", () => {
            const text = `Hey @[Alice](user:${userA}) and @[Alice Smith](user:${userA}), check this!`;
            const mentions = parseMentions(text);

            expect(mentions).toHaveLength(1);
            expect(mentions[0]!.userId).toBe(userA);
            expect(mentions[0]!.displayName).toBe("Alice");
        });

        it("parses multiple distinct mentions", () => {
            const text = `@[Alice](user:${userA}) and @[Bob Jones](user:${userB}) should sync with @[Charlie](user:${userC}).`;
            const mentions = parseMentions(text);

            expect(mentions).toHaveLength(3);
            expect(mentions.map(m => m.userId)).toEqual([userA, userB, userC]);
        });

        it("handles usernames/display names with special characters, unicode, and spaces", () => {
            const text = `Hello @[Jean-Luc Picard (Captain)](user:${userA}) and @[Dr. René / $pecial](user:${userB})!`;
            const mentions = parseMentions(text);

            expect(mentions).toHaveLength(2);
            expect(mentions[0]!.displayName).toBe("Jean-Luc Picard (Captain)");
            expect(mentions[1]!.displayName).toBe("Dr. René / $pecial");
        });
    });

    describe("validateMentions()", () => {
        function createMockPrisma() {
            return {
                membership: {
                    findMany: mock(async ({ where }: any) => {
                        const requestedIds: string[] = where.userId.in;
                        const matching: any[] = [];

                        if (where.orgId === orgId && where.accepted === true) {
                            if (requestedIds.includes(userA)) {
                                matching.push({
                                    userId: userA,
                                    user: { id: userA, username: "alice", name: "Alice Smith" }
                                });
                            }
                            if (requestedIds.includes(userB)) {
                                matching.push({
                                    userId: userB,
                                    user: { id: userB, username: "bob_j", name: null }
                                });
                            }
                        }
                        return matching;
                    })
                }
            };
        }

        it("validates and returns accepted org members", async () => {
            const mockClient = createMockPrisma();
            const parsed = [
                { displayName: "Alice", userId: userA },
                { displayName: "Bob", userId: userB }
            ];

            const validated = await validateMentions(parsed, orgId, authorId, mockClient);
            expect(validated).toHaveLength(2);
            expect(validated[0]).toEqual({
                userId: userA,
                displayName: "Alice",
                username: "alice"
            });
            expect(validated[1]).toEqual({
                userId: userB,
                displayName: "Bob",
                username: "bob_j"
            });
        });

        it("filters out non-existent userIds", async () => {
            const mockClient = createMockPrisma();
            const parsed = [{ displayName: "Ghost", userId: userNonExistent }];

            const validated = await validateMentions(parsed, orgId, authorId, mockClient);
            expect(validated).toHaveLength(0);
        });

        it("filters out users not in the org", async () => {
            const mockClient = createMockPrisma();
            const differentOrgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
            const parsed = [{ displayName: "Alice", userId: userA }];

            const validated = await validateMentions(parsed, differentOrgId, authorId, mockClient);
            expect(validated).toHaveLength(0);
        });

        it("filters out users with pending (unaccepted) membership", async () => {
            const mockClient = createMockPrisma();
            const parsed = [{ displayName: "Pending User", userId: userPending }];

            const validated = await validateMentions(parsed, orgId, authorId, mockClient);
            expect(validated).toHaveLength(0);
        });

        it("filters out self-mentions", async () => {
            const mockClient = createMockPrisma();
            const parsed = [
                { displayName: "Myself", userId: authorId },
                { displayName: "Alice", userId: userA }
            ];

            const validated = await validateMentions(parsed, orgId, authorId, mockClient);
            expect(validated).toHaveLength(1);
            expect(validated[0]!.userId).toBe(userA);
        });

        it("accepts string array of user IDs", async () => {
            const mockClient = createMockPrisma();
            const userIds = [userA, userNonExistent];

            const validated = await validateMentions(userIds, orgId, authorId, mockClient);
            expect(validated).toHaveLength(1);
            expect(validated[0]!.userId).toBe(userA);
            expect(validated[0]!.displayName).toBe("Alice Smith"); // Falls back to user.name
        });

        it("returns empty array for empty inputs without querying database", async () => {
            const mockClient = { membership: { findMany: mock(() => Promise.resolve([])) } };
            expect(await validateMentions([], orgId, authorId, mockClient)).toEqual([]);
            expect(await validateMentions(null as any, orgId, authorId, mockClient)).toEqual([]);
            expect(mockClient.membership.findMany).not.toHaveBeenCalled();
        });
    });
});
