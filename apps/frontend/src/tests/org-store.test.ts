import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { useOrgStore, ACTIVE_ORG_STORAGE_KEY } from "../store/useOrgStore";
import { orgApi, type UserOrgMembership, type Organization, type CreateOrgPayload } from "../lib/org-api";

describe("useOrgStore Zustand state management", () => {
  const originalGetUserOrgs = orgApi.getUserOrgs;
  const originalCreateOrg = orgApi.createOrg;
  const originalAcceptInvite = orgApi.acceptInvite;

  // Mock in-memory localStorage for test environment
  const storageMap = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storageMap.set(key, String(val));
    },
    removeItem: (key: string) => {
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

  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = { localStorage: mockLocalStorage };
    (globalThis as unknown as { localStorage: unknown }).localStorage = mockLocalStorage;
  });

  beforeEach(() => {
    storageMap.clear();
    useOrgStore.getState().resetOrgState();
  });

  afterEach(() => {
    orgApi.getUserOrgs = originalGetUserOrgs;
    orgApi.createOrg = originalCreateOrg;
    orgApi.acceptInvite = originalAcceptInvite;
    storageMap.clear();
  });

  afterAll(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  it("initializes with default empty state and null getters", () => {
    const state = useOrgStore.getState();
    expect(state.memberships).toEqual([]);
    expect(state.activeOrgId).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();

    expect(state.getActiveOrg()).toBeNull();
    expect(state.getActiveMembership()).toBeNull();
    expect(state.getAcceptedOrgs()).toEqual([]);
    expect(state.getPendingInvites()).toEqual([]);
  });

  it("caches computed getters across repeated calls to prevent React getSnapshot infinite re-render loops", () => {
    const state = useOrgStore.getState();

    // Repeated calls to getPendingInvites and getAcceptedOrgs must return the exact same array reference
    const invites1 = state.getPendingInvites();
    const invites2 = state.getPendingInvites();
    expect(invites1).toBe(invites2);

    const accepted1 = state.getAcceptedOrgs();
    const accepted2 = state.getAcceptedOrgs();
    expect(accepted1).toBe(accepted2);
  });

  describe("loadOrgs", () => {
    const mockMemberships: UserOrgMembership[] = [
      {
        id: "m-1",
        role: "admin",
        accepted: true,
        userId: "u-1",
        orgId: "org-accepted-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        acceptedAt: "2026-01-01T00:00:00Z",
        org: {
          id: "org-accepted-1",
          name: "Accepted Alpha",
          description: "First accepted org",
          visible: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z"
        }
      },
      {
        id: "m-2",
        role: "employee",
        accepted: true,
        userId: "u-1",
        orgId: "org-accepted-2",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        acceptedAt: "2026-01-02T00:00:00Z",
        org: {
          id: "org-accepted-2",
          name: "Accepted Beta",
          description: "Second accepted org",
          visible: false,
          createdAt: "2026-01-02T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z"
        }
      },
      {
        id: "m-3",
        role: "contributor",
        accepted: false,
        userId: "u-1",
        orgId: "org-pending-1",
        createdAt: "2026-01-03T00:00:00Z",
        updatedAt: "2026-01-03T00:00:00Z",
        acceptedAt: null,
        org: {
          id: "org-pending-1",
          name: "Pending Gamma",
          description: "Pending invite org",
          visible: true,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-03T00:00:00Z"
        }
      }
    ];

    it("partitions memberships into accepted organizations and pending invitations", async () => {
      orgApi.getUserOrgs = mock(() => Promise.resolve(mockMemberships)) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.memberships.length).toBe(3);

      const acceptedOrgs = state.getAcceptedOrgs();
      expect(acceptedOrgs.length).toBe(2);
      expect(acceptedOrgs[0]?.name).toBe("Accepted Alpha");
      expect(acceptedOrgs[1]?.name).toBe("Accepted Beta");

      const pendingInvites = state.getPendingInvites();
      expect(pendingInvites.length).toBe(1);
      expect(pendingInvites[0]?.org.name).toBe("Pending Gamma");
      expect(pendingInvites[0]?.accepted).toBe(false);
    });

    it("defaults activeOrgId to the first accepted org when no previous activeOrgId exists", async () => {
      orgApi.getUserOrgs = mock(() => Promise.resolve(mockMemberships)) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.activeOrgId).toBe("org-accepted-1");
      expect(state.getActiveOrg()?.name).toBe("Accepted Alpha");
      expect(state.getActiveMembership()?.role).toBe("admin");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-accepted-1");
    });

    it("preserves activeOrgId when valid stored activeOrgId matches an accepted org", async () => {
      mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "org-accepted-2");
      orgApi.getUserOrgs = mock(() => Promise.resolve(mockMemberships)) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.activeOrgId).toBe("org-accepted-2");
      expect(state.getActiveOrg()?.name).toBe("Accepted Beta");
      expect(state.getActiveMembership()?.role).toBe("employee");
    });

    it("falls back to first accepted org if stored activeOrgId matches an unaccepted pending invite", async () => {
      // Stored ID points to org-pending-1, which has accepted === false
      mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "org-pending-1");
      orgApi.getUserOrgs = mock(() => Promise.resolve(mockMemberships)) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.activeOrgId).toBe("org-accepted-1");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-accepted-1");
    });

    it("falls back to first accepted org if stored activeOrgId does not exist in memberships", async () => {
      mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "unknown-deleted-org");
      orgApi.getUserOrgs = mock(() => Promise.resolve(mockMemberships)) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.activeOrgId).toBe("org-accepted-1");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-accepted-1");
    });

    it("sets activeOrgId to null and clears localStorage when user has 0 accepted organizations", async () => {
      const onlyPending: UserOrgMembership[] = [
        {
          id: "m-3",
          role: "contributor",
          accepted: false,
          userId: "u-1",
          orgId: "org-pending-1",
          createdAt: "",
          updatedAt: "",
          acceptedAt: null,
          org: { id: "org-pending-1", name: "Pending", description: "", visible: true, createdAt: "", updatedAt: "" }
        }
      ];

      mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "old-org");
      orgApi.getUserOrgs = mock(() => Promise.resolve(onlyPending)) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.activeOrgId).toBeNull();
      expect(state.getActiveOrg()).toBeNull();
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();
    });

    it("captures and surfaces error message when API request fails", async () => {
      orgApi.getUserOrgs = mock(() => {
        const err = Object.assign(new Error("Request failed with status code 500"), {
          response: {
            status: 500,
            data: { success: false, error: "Internal server error fetching organizations" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof orgApi.getUserOrgs;

      await useOrgStore.getState().loadOrgs();

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("Internal server error fetching organizations");
    });

    it("commits loaded memberships and active selection even if localStorage throws QuotaExceededError", async () => {
      const originalSetItem = mockLocalStorage.setItem;
      mockLocalStorage.setItem = () => {
        throw new Error("QuotaExceededError: Dom storage quota exceeded");
      };

      try {
        orgApi.getUserOrgs = mock(() => Promise.resolve(mockMemberships)) as unknown as typeof orgApi.getUserOrgs;

        await useOrgStore.getState().loadOrgs();

        const state = useOrgStore.getState();
        expect(state.isLoading).toBe(false);
        expect(state.error).toBeNull();
        expect(state.memberships.length).toBe(3);
        expect(state.activeOrgId).toBe("org-accepted-1");
      } finally {
        mockLocalStorage.setItem = originalSetItem;
      }
    });
  });

  describe("setActiveOrgId", () => {
    it("updates store state and persists selected orgId to localStorage", () => {
      useOrgStore.getState().setActiveOrgId("org-selected-77");

      expect(useOrgStore.getState().activeOrgId).toBe("org-selected-77");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-selected-77");
    });

    it("removes active_org_id from localStorage when setting activeOrgId to null", () => {
      useOrgStore.getState().setActiveOrgId("org-selected-77");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-selected-77");

      useOrgStore.getState().setActiveOrgId(null);
      expect(useOrgStore.getState().activeOrgId).toBeNull();
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();
    });

    it("updates store state cleanly even if localStorage.setItem throws QuotaExceededError", () => {
      const originalSetItem = mockLocalStorage.setItem;
      mockLocalStorage.setItem = () => {
        throw new Error("QuotaExceededError: Dom storage quota exceeded");
      };

      try {
        expect(() => {
          useOrgStore.getState().setActiveOrgId("org-resilient-1");
        }).not.toThrow();

        expect(useOrgStore.getState().activeOrgId).toBe("org-resilient-1");
      } finally {
        mockLocalStorage.setItem = originalSetItem;
      }
    });

    it("updates store state cleanly even if localStorage.removeItem throws SecurityError", () => {
      const originalRemoveItem = mockLocalStorage.removeItem;
      mockLocalStorage.removeItem = () => {
        throw new Error("SecurityError: Access is denied for this document");
      };

      try {
        useOrgStore.setState({ activeOrgId: "org-prior" });
        expect(() => {
          useOrgStore.getState().setActiveOrgId(null);
        }).not.toThrow();

        expect(useOrgStore.getState().activeOrgId).toBeNull();
      } finally {
        mockLocalStorage.removeItem = originalRemoveItem;
      }
    });
  });

  describe("createOrg", () => {
    it("creates organization, reloads memberships, and sets newly created org as active", async () => {
      const createdOrg: Organization = {
        id: "org-brand-new",
        name: "Brand New Org",
        description: "Created via modal",
        visible: true,
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z"
      };

      const refreshedMemberships: UserOrgMembership[] = [
        {
          id: "m-new",
          role: "admin",
          accepted: true,
          userId: "u-1",
          orgId: "org-brand-new",
          createdAt: "2026-03-01T00:00:00Z",
          updatedAt: "2026-03-01T00:00:00Z",
          acceptedAt: "2026-03-01T00:00:00Z",
          org: createdOrg
        }
      ];

      let createOrgCalled = false;
      orgApi.createOrg = mock((payload: CreateOrgPayload) => {
        createOrgCalled = true;
        expect(payload.name).toBe("Brand New Org");
        return Promise.resolve(createdOrg);
      }) as unknown as typeof orgApi.createOrg;

      orgApi.getUserOrgs = mock(() => Promise.resolve(refreshedMemberships)) as unknown as typeof orgApi.getUserOrgs;

      const result = await useOrgStore.getState().createOrg({
        name: "Brand New Org",
        description: "Created via modal",
        visible: true
      });

      expect(createOrgCalled).toBe(true);
      expect(result.success).toBe(true);
      expect(result.org).toEqual(createdOrg);

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.activeOrgId).toBe("org-brand-new");
      expect(state.getActiveOrg()?.name).toBe("Brand New Org");
      expect(state.getActiveMembership()?.role).toBe("admin");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-brand-new");
    });

    it("handles creation failure (e.g. 409 duplicate name) gracefully without crashing store", async () => {
      orgApi.createOrg = mock(() => {
        const err = Object.assign(new Error("Request failed with status code 409"), {
          response: {
            status: 409,
            data: { success: false, error: "An organization with this name already exists" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof orgApi.createOrg;

      const result = await useOrgStore.getState().createOrg({
        name: "Duplicate Name",
        description: "Desc"
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("An organization with this name already exists");

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("An organization with this name already exists");
    });
  });

  describe("acceptInvite", () => {
    it("accepts invite, reloads memberships, and immediately switches active organization", async () => {
      const acceptedOrg: Organization = {
        id: "org-invited-1",
        name: "Invited Workspace",
        description: "Accepted invite",
        visible: true,
        createdAt: "2026-02-01T00:00:00Z",
        updatedAt: "2026-02-01T00:00:00Z"
      };

      const updatedMemberships: UserOrgMembership[] = [
        {
          id: "m-inv",
          role: "contributor",
          accepted: true,
          userId: "u-1",
          orgId: "org-invited-1",
          createdAt: "2026-02-01T00:00:00Z",
          updatedAt: "2026-02-02T00:00:00Z",
          acceptedAt: "2026-02-02T00:00:00Z",
          org: acceptedOrg
        }
      ];

      let acceptInviteOrgId = "";
      orgApi.acceptInvite = mock((orgId: string) => {
        acceptInviteOrgId = orgId;
        return Promise.resolve("Invitation accepted");
      }) as unknown as typeof orgApi.acceptInvite;

      orgApi.getUserOrgs = mock(() => Promise.resolve(updatedMemberships)) as unknown as typeof orgApi.getUserOrgs;

      const result = await useOrgStore.getState().acceptInvite("org-invited-1");

      expect(acceptInviteOrgId).toBe("org-invited-1");
      expect(result.success).toBe(true);

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.activeOrgId).toBe("org-invited-1");
      expect(state.getActiveOrg()?.name).toBe("Invited Workspace");
      expect(state.getActiveMembership()?.role).toBe("contributor");
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBe("org-invited-1");
    });

    it("handles acceptInvite failure gracefully", async () => {
      orgApi.acceptInvite = mock(() => {
        const err = Object.assign(new Error("Bad Request"), {
          response: {
            status: 400,
            data: { success: false, error: "Invitation expired or invalid" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof orgApi.acceptInvite;

      const result = await useOrgStore.getState().acceptInvite("invalid-org-id");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invitation expired or invalid");

      const state = useOrgStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe("Invitation expired or invalid");
    });
  });

  describe("resetOrgState", () => {
    it("clears state and removes active_org_id from localStorage on logout", () => {
      // Seed state
      useOrgStore.setState({
        memberships: [
          {
            id: "m-1",
            role: "admin",
            accepted: true,
            userId: "u-1",
            orgId: "org-1",
            createdAt: "",
            updatedAt: "",
            acceptedAt: "",
            org: { id: "org-1", name: "Org", description: "", visible: true, createdAt: "", updatedAt: "" }
          }
        ],
        activeOrgId: "org-1",
        isLoading: true,
        error: "Previous error"
      });
      mockLocalStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "org-1");

      useOrgStore.getState().resetOrgState();

      const state = useOrgStore.getState();
      expect(state.memberships).toEqual([]);
      expect(state.activeOrgId).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockLocalStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();
    });

    it("clears state cleanly even if localStorage.removeItem throws SecurityError", () => {
      const originalRemoveItem = mockLocalStorage.removeItem;
      mockLocalStorage.removeItem = () => {
        throw new Error("SecurityError: Access is denied for this document");
      };

      try {
        useOrgStore.setState({ activeOrgId: "org-1" });
        expect(() => {
          useOrgStore.getState().resetOrgState();
        }).not.toThrow();

        const state = useOrgStore.getState();
        expect(state.activeOrgId).toBeNull();
        expect(state.memberships).toEqual([]);
      } finally {
        mockLocalStorage.removeItem = originalRemoveItem;
      }
    });
  });
});
