import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { useOrgStore, ACTIVE_ORG_STORAGE_KEY } from "../store/useOrgStore";
import {
  orgApi,
  getOrgErrorMessage,
  type UserOrgMembership,
  type Organization
} from "../lib/org-api";

describe("Adversarial Stress Harness: Org Store & API Resilience", () => {
  const originalGetUserOrgs = orgApi.getUserOrgs;
  const originalCreateOrg = orgApi.createOrg;
  const originalAcceptInvite = orgApi.acceptInvite;
  const originalGetOrgDetails = orgApi.getOrgDetails;
  const originalGetOrgMembers = orgApi.getOrgMembers;
  const originalInviteMember = orgApi.inviteMember;
  const originalUpdateMemberRole = orgApi.updateMemberRole;
  const originalRemoveMember = orgApi.removeMember;

  const storageMap = new Map<string, string>();
  let storageThrowsOnGet = false;
  let storageThrowsOnSet = false;
  let storageThrowsOnRemove = false;

  const mockLocalStorage = {
    getItem: (key: string) => {
      if (storageThrowsOnGet) throw new Error("SecurityError: Access is denied for this document");
      return storageMap.get(key) ?? null;
    },
    setItem: (key: string, val: string) => {
      if (storageThrowsOnSet) throw new Error("QuotaExceededError: Dom storage quota exceeded");
      storageMap.set(key, String(val));
    },
    removeItem: (key: string) => {
      if (storageThrowsOnRemove) throw new Error("SecurityError: Access is denied for this document");
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    get length() {
      return storageMap.size;
    },
    key: () => null
  };

  const createMockMembership = (id: string, orgId: string, name: string, accepted = true, role: "admin" | "employee" | "contributor" = "admin"): UserOrgMembership => ({
    id,
    role,
    accepted,
    userId: "user-test",
    orgId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    acceptedAt: accepted ? "2026-01-01T00:00:00Z" : null,
    org: {
      id: orgId,
      name,
      description: `Description for ${name}`,
      visible: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    }
  });

  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = { localStorage: mockLocalStorage };
    (globalThis as unknown as { localStorage: unknown }).localStorage = mockLocalStorage;
  });

  beforeEach(() => {
    storageMap.clear();
    storageThrowsOnGet = false;
    storageThrowsOnSet = false;
    storageThrowsOnRemove = false;
    useOrgStore.getState().resetOrgState();
  });

  afterEach(() => {
    orgApi.getUserOrgs = originalGetUserOrgs;
    orgApi.createOrg = originalCreateOrg;
    orgApi.acceptInvite = originalAcceptInvite;
    orgApi.getOrgDetails = originalGetOrgDetails;
    orgApi.getOrgMembers = originalGetOrgMembers;
    orgApi.inviteMember = originalInviteMember;
    orgApi.updateMemberRole = originalUpdateMemberRole;
    orgApi.removeMember = originalRemoveMember;
    storageMap.clear();
    storageThrowsOnGet = false;
    storageThrowsOnSet = false;
    storageThrowsOnRemove = false;
  });

  afterAll(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  // =========================================================================
  // 1. STATE MUTATION STRESS TESTING
  // =========================================================================
  describe("1. State Mutation Stress Testing", () => {
    it("handles 1,000 rapid synchronous active organization switches without desynchronization", () => {
      const orgCount = 10;
      const memberships = Array.from({ length: orgCount }, (_, i) =>
        createMockMembership(`m-${i}`, `org-${i}`, `Organization ${i}`, true)
      );

      useOrgStore.setState({ memberships, activeOrgId: "org-0" });

      for (let i = 0; i < 1000; i++) {
        const targetOrgId = `org-${i % orgCount}`;
        useOrgStore.getState().setActiveOrgId(targetOrgId);

        const activeOrg = useOrgStore.getState().getActiveOrg();
        const activeMembership = useOrgStore.getState().getActiveMembership();

        expect(useOrgStore.getState().activeOrgId).toBe(targetOrgId);
        expect(activeOrg?.id).toBe(targetOrgId);
        expect(activeMembership?.orgId).toBe(targetOrgId);
        expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe(targetOrgId);
      }
    });

    it("evaluates getters safely when switching to non-existent or null orgId", () => {
      const memberships = [
        createMockMembership("m-1", "org-1", "Org One", true),
        createMockMembership("m-2", "org-2", "Org Two", false) // unaccepted
      ];
      useOrgStore.setState({ memberships, activeOrgId: "org-1" });

      // Switch to unaccepted org
      useOrgStore.getState().setActiveOrgId("org-2");
      expect(useOrgStore.getState().activeOrgId).toBe("org-2");
      expect(useOrgStore.getState().getActiveOrg()).toBeNull();
      expect(useOrgStore.getState().getActiveMembership()).toBeNull();

      // Switch to non-existent org
      useOrgStore.getState().setActiveOrgId("org-phantom-999");
      expect(useOrgStore.getState().activeOrgId).toBe("org-phantom-999");
      expect(useOrgStore.getState().getActiveOrg()).toBeNull();
      expect(useOrgStore.getState().getActiveMembership()).toBeNull();

      // Switch to null
      useOrgStore.getState().setActiveOrgId(null);
      expect(useOrgStore.getState().activeOrgId).toBeNull();
      expect(useOrgStore.getState().getActiveOrg()).toBeNull();
      expect(useOrgStore.getState().getActiveMembership()).toBeNull();
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();
    });

    it("verifies behavior when user transitions from 0 accepted orgs to multiple orgs", async () => {
      // Step A: Initial load with 0 memberships
      orgApi.getUserOrgs = mock(() => Promise.resolve([])) as unknown as typeof orgApi.getUserOrgs;
      await useOrgStore.getState().loadOrgs();

      expect(useOrgStore.getState().activeOrgId).toBeNull();
      expect(useOrgStore.getState().getAcceptedOrgs()).toEqual([]);
      expect(useOrgStore.getState().getPendingInvites()).toEqual([]);
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();

      // Step B: Only pending invitation
      const pendingOnly = [createMockMembership("m-p1", "org-p1", "Pending Org", false)];
      orgApi.getUserOrgs = mock(() => Promise.resolve(pendingOnly)) as unknown as typeof orgApi.getUserOrgs;
      await useOrgStore.getState().loadOrgs();

      expect(useOrgStore.getState().activeOrgId).toBeNull();
      expect(useOrgStore.getState().getAcceptedOrgs()).toEqual([]);
      expect(useOrgStore.getState().getPendingInvites().length).toBe(1);

      // Step C: Accept invitation -> transitions to active
      const acceptedList = [createMockMembership("m-p1", "org-p1", "Pending Org", true)];
      orgApi.acceptInvite = mock(() => Promise.resolve("Accepted")) as unknown as typeof orgApi.acceptInvite;
      orgApi.getUserOrgs = mock(() => Promise.resolve(acceptedList)) as unknown as typeof orgApi.getUserOrgs;

      const acceptRes = await useOrgStore.getState().acceptInvite("org-p1");
      expect(acceptRes.success).toBe(true);
      expect(useOrgStore.getState().activeOrgId).toBe("org-p1");
      expect(useOrgStore.getState().getActiveOrg()?.name).toBe("Pending Org");
      expect(useOrgStore.getState().getAcceptedOrgs().length).toBe(1);

      // Step D: Create a 2nd org -> automatically switches to the new org
      const newOrg: Organization = {
        id: "org-new-2",
        name: "Second Org",
        description: "New Org",
        visible: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      };
      const multipleMemberships = [
        ...acceptedList,
        createMockMembership("m-new-2", "org-new-2", "Second Org", true)
      ];
      orgApi.createOrg = mock(() => Promise.resolve(newOrg)) as unknown as typeof orgApi.createOrg;
      orgApi.getUserOrgs = mock(() => Promise.resolve(multipleMemberships)) as unknown as typeof orgApi.getUserOrgs;

      const createRes = await useOrgStore.getState().createOrg({ name: "Second Org", description: "New Org" });
      expect(createRes.success).toBe(true);
      expect(useOrgStore.getState().activeOrgId).toBe("org-new-2");
      expect(useOrgStore.getState().getAcceptedOrgs().length).toBe(2);
    });

    it("preserves active org when reloading if candidateId is still accepted", async () => {
      const list = [
        createMockMembership("m-1", "org-1", "Org One", true),
        createMockMembership("m-2", "org-2", "Org Two", true),
        createMockMembership("m-3", "org-3", "Org Three", true)
      ];
      orgApi.getUserOrgs = mock(() => Promise.resolve(list)) as unknown as typeof orgApi.getUserOrgs;

      // User selects org-2
      useOrgStore.getState().setActiveOrgId("org-2");
      await useOrgStore.getState().loadOrgs();

      expect(useOrgStore.getState().activeOrgId).toBe("org-2");
      expect(useOrgStore.getState().getActiveOrg()?.name).toBe("Org Two");
    });
  });

  // =========================================================================
  // 2. LOCALSTORAGE CORRUPTION & UNEXPECTED VALUES
  // =========================================================================
  describe("2. LocalStorage Corruption and Graceful Recovery", () => {
    const validMemberships = [
      createMockMembership("m-alpha", "org-alpha-123", "Alpha Corp", true),
      createMockMembership("m-beta", "org-beta-456", "Beta LLC", true)
    ];

    const corruptedValues = [
      "",
      "   ",
      "undefined",
      "null",
      "0",
      "false",
      "NaN",
      "[object Object]",
      "{\"id\":\"not-a-string\"}",
      "<script>alert('xss')</script>",
      "'; DROP TABLE orgs; --",
      "non-existent-uuid-9999-ffff",
      "A".repeat(10000), // Massive string
      "⚡🚀✨🎉", // Unicode / Emojis
      "\x00\x01\x02\x1F" // Control characters
    ];

    corruptedValues.forEach(badVal => {
      it(`gracefully recovers from corrupted localStorage value: "${badVal.slice(0, 20)}..."`, async () => {
        mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, badVal);
        useOrgStore.setState({ activeOrgId: null });

        orgApi.getUserOrgs = mock(() => Promise.resolve(validMemberships)) as unknown as typeof orgApi.getUserOrgs;

        await useOrgStore.getState().loadOrgs();

        const state = useOrgStore.getState();
        // Since badVal is not an accepted org ID, resolvedActiveId must heal to first accepted org
        expect(state.activeOrgId).toBe("org-alpha-123");
        expect(state.getActiveOrg()?.name).toBe("Alpha Corp");
        expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-alpha-123");
      });
    });

    it("clears corrupted localStorage value when user has zero accepted memberships", async () => {
      mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "corrupted-or-expired-org");
      orgApi.getUserOrgs = mock(() => Promise.resolve([])) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.activeOrgId).toBeNull();
      expect(state.getActiveOrg()).toBeNull();
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();
    });

    it("empirically tests resilience if localStorage throws SecurityError or QuotaExceededError", async () => {
      // Test when setItem throws (e.g. QuotaExceededError in private browsing)
      storageThrowsOnSet = true;
      const orgList = [createMockMembership("m-1", "org-1", "Org 1", true)];
      orgApi.getUserOrgs = mock(() => Promise.resolve(orgList)) as unknown as typeof orgApi.getUserOrgs;

      // Verify that loadOrgs survives and commits fetched data cleanly into memory
      let loadError: unknown = null;
      try {
        await useOrgStore.getState().loadOrgs();
      } catch (err) {
        loadError = err;
      }

      storageThrowsOnSet = false;
      expect(loadError).toBeNull();
      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.memberships.length).toBe(1);
      expect(state.activeOrgId).toBe("org-1");

      // Verify that setActiveOrgId updates in-memory activeOrgId without throwing even if setItem throws
      storageThrowsOnSet = true;
      expect(() => {
        useOrgStore.getState().setActiveOrgId("org-another");
      }).not.toThrow();
      expect(useOrgStore.getState().activeOrgId).toBe("org-another");
      storageThrowsOnSet = false;

      // Verify that resetOrgState resets state without throwing even if removeItem throws
      storageThrowsOnRemove = true;
      expect(() => {
        useOrgStore.getState().resetOrgState();
      }).not.toThrow();
      expect(useOrgStore.getState().activeOrgId).toBeNull();
      expect(useOrgStore.getState().memberships).toEqual([]);
      storageThrowsOnRemove = false;

      // Verify that loadOrgs survives even if getItem throws SecurityError
      storageThrowsOnGet = true;
      await useOrgStore.getState().loadOrgs();
      expect(useOrgStore.getState().activeOrgId).toBe("org-1");
      storageThrowsOnGet = false;
    });
  });

  // =========================================================================
  // 3. CONCURRENT / OVERLAPPING REQUESTS STRESS
  // =========================================================================
  describe("3. Concurrent / Overlapping Requests", () => {
    it("handles multiple concurrent loadOrgs calls without corrupting state", async () => {
      const memberships = [
        createMockMembership("m-1", "org-1", "Org One", true),
        createMockMembership("m-2", "org-2", "Org Two", true)
      ];

      let callCount = 0;
      orgApi.getUserOrgs = mock(async () => {
        callCount++;
        await new Promise(res => setTimeout(res, 10));
        return memberships;
      }) as unknown as typeof orgApi.getUserOrgs;

      // Fire 10 concurrent loadOrgs requests
      await Promise.all(Array.from({ length: 10 }, () => useOrgStore.getState().loadOrgs()));

      expect(callCount).toBe(10);
      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.memberships.length).toBe(2);
      expect(state.activeOrgId).toBe("org-1");
    });

    it("handles race condition where an older loadOrgs finishes after a manual setActiveOrgId", async () => {
      const memberships = [
        createMockMembership("m-1", "org-1", "Org One", true),
        createMockMembership("m-2", "org-2", "Org Two", true)
      ];

      orgApi.getUserOrgs = mock(async () => {
        // Simulate network delay
        await new Promise(res => setTimeout(res, 25));
        return memberships;
      }) as unknown as typeof orgApi.getUserOrgs;

      // Start loadOrgs
      const loadPromise = useOrgStore.getState().loadOrgs();

      // Midway while loadOrgs is in-flight, user explicitly switches to org-2
      useOrgStore.getState().setActiveOrgId("org-2");

      // Wait for loadOrgs to complete
      await loadPromise;

      // In loadOrgs: candidateId = get().activeOrgId || getStoredActiveOrgId();
      // Since candidateId is evaluated after await getUserOrgs(), it should pick up org-2!
      expect(useOrgStore.getState().activeOrgId).toBe("org-2");
      expect(useOrgStore.getState().getActiveOrg()?.name).toBe("Org Two");
    });

    it("stress tests 50 simultaneous mixed operations (loadOrgs, setActiveOrgId, resetOrgState)", async () => {
      const memberships = [
        createMockMembership("m-1", "org-1", "Org One", true),
        createMockMembership("m-2", "org-2", "Org Two", true)
      ];

      orgApi.getUserOrgs = mock(async () => {
        await new Promise(res => setTimeout(res, Math.floor(Math.random() * 5)));
        return memberships;
      }) as unknown as typeof orgApi.getUserOrgs;

      const operations = Array.from({ length: 50 }, (_, i) => {
        if (i % 3 === 0) {
          return useOrgStore.getState().loadOrgs();
        } else if (i % 3 === 1) {
          useOrgStore.getState().setActiveOrgId(i % 2 === 0 ? "org-1" : "org-2");
          return Promise.resolve();
        } else {
          const org = useOrgStore.getState().getActiveOrg();
          expect(org === null || org.id === "org-1" || org.id === "org-2").toBe(true);
          return Promise.resolve();
        }
      });

      await Promise.all(operations);

      // Verify the store reaches a consistent terminal state
      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // =========================================================================
  // 4. API ERROR HANDLING & STATUS CODE RESILIENCE (400, 401, 403, 404, 409, 500)
  // =========================================================================
  describe("4. API Error Handling & Status Code Resilience", () => {
    const errorTestCases = [
      {
        status: 400,
        name: "400 Bad Request with data.error",
        errorPayload: {
          response: { status: 400, data: { success: false, error: "Invalid organization name syntax" } }
        },
        expectedMessage: "Invalid organization name syntax"
      },
      {
        status: 400,
        name: "400 Bad Request with data.message fallback",
        errorPayload: {
          response: { status: 400, data: { message: "Validation error on field 'email'" } }
        },
        expectedMessage: "Validation error on field 'email'"
      },
      {
        status: 401,
        name: "401 Unauthorized session expired",
        errorPayload: {
          response: { status: 401, data: { success: false, error: "Authentication token expired" } }
        },
        expectedMessage: "Authentication token expired"
      },
      {
        status: 403,
        name: "403 Forbidden last admin removal guard",
        errorPayload: {
          response: { status: 403, data: { success: false, error: "Cannot remove the last remaining admin" } }
        },
        expectedMessage: "Cannot remove the last remaining admin"
      },
      {
        status: 403,
        name: "403 Forbidden insufficient role permissions",
        errorPayload: {
          response: { status: 403, data: { success: false, error: "You must be an accepted admin to invite members" } }
        },
        expectedMessage: "You must be an accepted admin to invite members"
      },
      {
        status: 404,
        name: "404 Not Found user not registered",
        errorPayload: {
          response: { status: 404, data: { success: false, error: "User not signed up" } }
        },
        expectedMessage: "User not signed up"
      },
      {
        status: 404,
        name: "404 Not Found organization not found",
        errorPayload: {
          response: { status: 404, data: { success: false, error: "Organization not found" } }
        },
        expectedMessage: "Organization not found"
      },
      {
        status: 409,
        name: "409 Conflict duplicate organization name",
        errorPayload: {
          response: { status: 409, data: { success: false, error: "An organization with this name already exists" } }
        },
        expectedMessage: "An organization with this name already exists"
      },
      {
        status: 409,
        name: "409 Conflict user already member",
        errorPayload: {
          response: { status: 409, data: { success: false, error: "User already member" } }
        },
        expectedMessage: "User already member"
      },
      {
        status: 500,
        name: "500 Internal Server Error with custom error message",
        errorPayload: {
          response: { status: 500, data: { success: false, error: "Database connection failed during transaction" } }
        },
        expectedMessage: "Database connection failed during transaction"
      },
      {
        status: 500,
        name: "500 Internal Server Error without data body (falls back to err.message)",
        errorPayload: {
          response: { status: 500, data: null },
          message: "Request failed with status code 500"
        },
        expectedMessage: "Request failed with status code 500"
      },
      {
        status: 502,
        name: "502 Bad Gateway HTML response from proxy",
        errorPayload: {
          response: { status: 502, data: "<html><body>502 Bad Gateway</body></html>" },
          message: "Request failed with status code 502"
        },
        expectedMessage: "Request failed with status code 502"
      },
      {
        status: 0,
        name: "Network Error (no response object, e.g. ECONNREFUSED)",
        errorPayload: {
          message: "Network Error: connect ECONNREFUSED 127.0.0.1:3001"
        },
        expectedMessage: "Network Error: connect ECONNREFUSED 127.0.0.1:3001"
      },
      {
        status: 0,
        name: "Axios timeout error (ECONNABORTED)",
        errorPayload: {
          code: "ECONNABORTED",
          message: "timeout of 5000ms exceeded"
        },
        expectedMessage: "timeout of 5000ms exceeded"
      }
    ];

    errorTestCases.forEach(tc => {
      it(`correctly extracts and formats error for: ${tc.name}`, () => {
        const msg = getOrgErrorMessage(tc.errorPayload);
        expect(msg).toBe(tc.expectedMessage);
      });
    });

    it("verifies store actions catch and store error message on failure", async () => {
      // Test createOrg failure
      orgApi.createOrg = mock(() =>
        Promise.reject({
          response: { status: 409, data: { success: false, error: "Org name taken" } }
        })
      ) as unknown as typeof orgApi.createOrg;

      const res1 = await useOrgStore.getState().createOrg({ name: "Existing", description: "Desc" });
      expect(res1.success).toBe(false);
      expect(res1.error).toBe("Org name taken");
      expect(useOrgStore.getState().error).toBe("Org name taken");
      expect(useOrgStore.getState().isLoading).toBe(false);

      // Test acceptInvite failure
      orgApi.acceptInvite = mock(() =>
        Promise.reject({
          response: { status: 400, data: { success: false, error: "Invite expired" } }
        })
      ) as unknown as typeof orgApi.acceptInvite;

      const res2 = await useOrgStore.getState().acceptInvite("org-expired");
      expect(res2.success).toBe(false);
      expect(res2.error).toBe("Invite expired");
      expect(useOrgStore.getState().error).toBe("Invite expired");
      expect(useOrgStore.getState().isLoading).toBe(false);

      // Test loadOrgs failure
      orgApi.getUserOrgs = mock(() =>
        Promise.reject(new Error("Network timeout"))
      ) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();
      expect(useOrgStore.getState().error).toBe("Network timeout");
      expect(useOrgStore.getState().isLoading).toBe(false);
    });

    it("ensures transient network error on loadOrgs does not wipe existing memberships or active selection", async () => {
      // Seed existing valid state
      const initialMemberships = [
        createMockMembership("m-1", "org-1", "Org Alpha", true),
        createMockMembership("m-2", "org-2", "Org Beta", true)
      ];
      useOrgStore.setState({
        memberships: initialMemberships,
        activeOrgId: "org-2",
        isLoading: false,
        error: null
      });

      // Subsequent call fails with 500
      orgApi.getUserOrgs = mock(() =>
        Promise.reject({
          response: { status: 500, data: { success: false, error: "Internal Server Error" } }
        })
      ) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.error).toBe("Internal Server Error");
      expect(state.isLoading).toBe(false);
      // Crucial: Memberships and activeOrgId must NOT be wiped out
      expect(state.memberships.length).toBe(2);
      expect(state.activeOrgId).toBe("org-2");
      expect(state.getActiveOrg()?.name).toBe("Org Beta");
    });

    it("handles concurrent createOrg and acceptInvite operations gracefully", async () => {
      const createdOrg: Organization = {
        id: "org-concurrent-created",
        name: "Created Org",
        description: "",
        visible: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z"
      };

      const membershipsState: UserOrgMembership[] = [
        createMockMembership("m-1", "org-1", "Org One", true),
        createMockMembership("m-2", "org-concurrent-created", "Created Org", true),
        createMockMembership("m-3", "org-concurrent-accepted", "Accepted Org", true)
      ];

      orgApi.createOrg = mock(async () => {
        await new Promise(r => setTimeout(r, 15));
        return createdOrg;
      }) as unknown as typeof orgApi.createOrg;

      orgApi.acceptInvite = mock(async () => {
        await new Promise(r => setTimeout(r, 10));
        return "Accepted";
      }) as unknown as typeof orgApi.acceptInvite;

      orgApi.getUserOrgs = mock(async () => {
        await new Promise(r => setTimeout(r, 5));
        return membershipsState;
      }) as unknown as typeof orgApi.getUserOrgs;

      const [resCreate, resAccept] = await Promise.all([
        useOrgStore.getState().createOrg({ name: "Created Org", description: "" }),
        useOrgStore.getState().acceptInvite("org-concurrent-accepted")
      ]);

      expect(resCreate.success).toBe(true);
      expect(resAccept.success).toBe(true);

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      // One of the two resolved last and became activeOrgId
      expect(
        state.activeOrgId === "org-concurrent-created" ||
        state.activeOrgId === "org-concurrent-accepted"
      ).toBe(true);
      expect(state.getActiveOrg()).not.toBeNull();
    });
  });
});

