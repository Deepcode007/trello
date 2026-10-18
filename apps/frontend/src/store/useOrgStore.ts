import { create } from "zustand";
import {
  orgApi,
  getOrgErrorMessage,
  type Organization,
  type UserOrgMembership,
  type CreateOrgPayload
} from "../lib/org-api";

export const ACTIVE_ORG_STORAGE_KEY = "active_org_id";

function getStoredActiveOrgId(): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    }
  } catch {
    // Gracefully handle SecurityError / restricted storage in sandboxed or private browsing environments
    return null;
  }
  return null;
}

function persistActiveOrgId(orgId: string | null): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      if (orgId) {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
      } else {
        localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
      }
    }
  } catch {
    // Gracefully handle SecurityError or QuotaExceededError (e.g. private mode, quota full)
  }
}

export interface OrgState {
  memberships: UserOrgMembership[];
  activeOrgId: string | null;
  isLoading: boolean;
  error: string | null;

  // Computed getters
  getActiveOrg: () => Organization | null;
  getActiveMembership: () => UserOrgMembership | null;
  getAcceptedOrgs: () => Organization[];
  getPendingInvites: () => UserOrgMembership[];

  // Actions
  loadOrgs: () => Promise<void>;
  setActiveOrgId: (orgId: string | null) => void;
  createOrg: (payload: CreateOrgPayload) => Promise<{ success: boolean; org?: Organization; error?: string }>;
  acceptInvite: (orgId: string) => Promise<{ success: boolean; error?: string }>;
  resetOrgState: () => void;
}

// Reference cache for computed getters to guarantee getSnapshot reference stability under React 18/19 useSyncExternalStore
let cachedMembershipsForPending: UserOrgMembership[] | null = null;
let cachedPendingInvites: UserOrgMembership[] = [];

let cachedMembershipsForAccepted: UserOrgMembership[] | null = null;
let cachedAcceptedOrgs: Organization[] = [];

let cachedMembershipsForActiveOrg: UserOrgMembership[] | null = null;
let cachedActiveOrgId: string | null = null;
let cachedActiveOrg: Organization | null = null;

let cachedMembershipsForActiveMembership: UserOrgMembership[] | null = null;
let cachedActiveMembershipOrgId: string | null = null;
let cachedActiveMembership: UserOrgMembership | null = null;

export function clearOrgStoreCache(): void {
  cachedMembershipsForPending = null;
  cachedPendingInvites = [];
  cachedMembershipsForAccepted = null;
  cachedAcceptedOrgs = [];
  cachedMembershipsForActiveOrg = null;
  cachedActiveOrgId = null;
  cachedActiveOrg = null;
  cachedMembershipsForActiveMembership = null;
  cachedActiveMembershipOrgId = null;
  cachedActiveMembership = null;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  memberships: [],
  activeOrgId: getStoredActiveOrgId(),
  isLoading: false,
  error: null,

  getActiveOrg: () => {
    const { memberships, activeOrgId } = get();
    if (!activeOrgId) return null;
    if (
      cachedMembershipsForActiveOrg === memberships &&
      cachedActiveOrgId === activeOrgId
    ) {
      return cachedActiveOrg;
    }
    const membership = memberships.find(m => m.orgId === activeOrgId && m.accepted);
    cachedMembershipsForActiveOrg = memberships;
    cachedActiveOrgId = activeOrgId;
    cachedActiveOrg = membership ? membership.org : null;
    return cachedActiveOrg;
  },

  getActiveMembership: () => {
    const { memberships, activeOrgId } = get();
    if (!activeOrgId) return null;
    if (
      cachedMembershipsForActiveMembership === memberships &&
      cachedActiveMembershipOrgId === activeOrgId
    ) {
      return cachedActiveMembership;
    }
    const membership = memberships.find(m => m.orgId === activeOrgId && m.accepted) || null;
    cachedMembershipsForActiveMembership = memberships;
    cachedActiveMembershipOrgId = activeOrgId;
    cachedActiveMembership = membership;
    return cachedActiveMembership;
  },

  getAcceptedOrgs: () => {
    const { memberships } = get();
    if (cachedMembershipsForAccepted === memberships) {
      return cachedAcceptedOrgs;
    }
    cachedMembershipsForAccepted = memberships;
    cachedAcceptedOrgs = memberships
      .filter(m => m.accepted)
      .map(m => m.org);
    return cachedAcceptedOrgs;
  },

  getPendingInvites: () => {
    const { memberships } = get();
    if (cachedMembershipsForPending === memberships) {
      return cachedPendingInvites;
    }
    cachedMembershipsForPending = memberships;
    cachedPendingInvites = memberships.filter(m => !m.accepted);
    return cachedPendingInvites;
  },

  loadOrgs: async () => {
    set({ isLoading: true, error: null });

    try {
      const memberships = await orgApi.getUserOrgs();
      const acceptedMemberships = memberships.filter(m => m.accepted);

      const candidateId = get().activeOrgId || getStoredActiveOrgId();
      let resolvedActiveId: string | null = null;

      if (candidateId && acceptedMemberships.some(m => m.orgId === candidateId)) {
        resolvedActiveId = candidateId;
      } else if (acceptedMemberships.length > 0) {
        resolvedActiveId = acceptedMemberships[0]?.orgId ?? null;
      } else {
        resolvedActiveId = null;
      }

      try {
        persistActiveOrgId(resolvedActiveId);
      } catch {
        // Safe fallback: persistence failure must never block committing state to memory
      }

      set({
        memberships,
        activeOrgId: resolvedActiveId,
        isLoading: false
      });
    } catch (err: unknown) {
      const errorMessage = getOrgErrorMessage(err, "Failed to load organizations");
      set({
        error: errorMessage,
        isLoading: false
      });
    }
  },

  setActiveOrgId: (orgId: string | null) => {
    try {
      persistActiveOrgId(orgId);
    } catch {
      // Safe fallback: persistence failure must never block in-memory state update
    }
    set({ activeOrgId: orgId });
  },

  createOrg: async (payload: CreateOrgPayload) => {
    set({ isLoading: true, error: null });

    try {
      const createdOrg = await orgApi.createOrg(payload);
      // Reload full membership list to ensure complete relations and active roles are in sync
      await get().loadOrgs();
      // Explicitly activate the newly created organization
      get().setActiveOrgId(createdOrg.id);
      set({ isLoading: false });
      return { success: true, org: createdOrg };
    } catch (err: unknown) {
      const errorMessage = getOrgErrorMessage(err, "Failed to create organization");
      set({ error: errorMessage, isLoading: false });
      return { success: false, error: errorMessage };
    }
  },

  acceptInvite: async (orgId: string) => {
    set({ isLoading: true, error: null });

    try {
      await orgApi.acceptInvite(orgId);
      // Refresh list to transition unaccepted membership to accepted
      await get().loadOrgs();
      // Immediately switch to the accepted organization
      get().setActiveOrgId(orgId);
      set({ isLoading: false });
      return { success: true };
    } catch (err: unknown) {
      const errorMessage = getOrgErrorMessage(err, "Failed to accept invitation");
      set({ error: errorMessage, isLoading: false });
      return { success: false, error: errorMessage };
    }
  },

  resetOrgState: () => {
    clearOrgStoreCache();
    try {
      persistActiveOrgId(null);
    } catch {
      // Safe fallback: persistence failure must never block in-memory state reset
    }
    set({
      memberships: [],
      activeOrgId: null,
      isLoading: false,
      error: null
    });
  }
}));
