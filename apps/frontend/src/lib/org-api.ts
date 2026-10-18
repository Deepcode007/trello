import { api } from "./api";

export type OrgRole = "admin" | "employee" | "contributor";

export interface Organization {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserOrgMembership {
  id: string;
  role: OrgRole;
  accepted: boolean;
  userId: string;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  org: Organization;
}

export interface OrgMemberItem {
  role: OrgRole;
  accepted: boolean;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  user: {
    username: string;
    email: string;
  };
}

export interface CreateOrgPayload {
  name: string;
  description: string;
  visible?: boolean;
}

export interface InviteMemberPayload {
  email: string;
}

export interface UpdateMemberRolePayload {
  email: string;
  role: OrgRole;
}

export interface RemoveMemberPayload {
  email: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

/**
 * Helper to safely extract user-friendly error messages from API rejections.
 */
export function getOrgErrorMessage(err: unknown, fallbackMessage = "An unexpected error occurred"): string {
  if (err && typeof err === "object") {
    const axiosErr = err as {
      response?: {
        status?: number;
        data?: {
          error?: string;
          message?: string;
        };
      };
      message?: string;
    };

    const serverError = axiosErr.response?.data?.error || axiosErr.response?.data?.message;
    if (serverError && typeof serverError === "string") {
      return serverError;
    }

    if (axiosErr.message && typeof axiosErr.message === "string") {
      return axiosErr.message;
    }
  }

  return fallbackMessage;
}

export const orgApi = {
  /**
   * GET /api/orgs
   * List all organization memberships (both accepted and pending invitations) for the current user.
   */
  getUserOrgs: async (): Promise<UserOrgMembership[]> => {
    const res = await api.get<{ success: boolean; data: UserOrgMembership[] }>("/api/orgs");
    return res.data.data;
  },

  /**
   * POST /api/orgs
   * Create a new organization. Current user automatically becomes an accepted admin.
   */
  createOrg: async (payload: CreateOrgPayload): Promise<Organization> => {
    const res = await api.post<{ success: boolean; data: Organization }>("/api/orgs", payload);
    return res.data.data;
  },

  /**
   * GET /api/orgs/:orgId
   * Fetch specific organization details if public or user has accepted membership.
   */
  getOrgDetails: async (orgId: string): Promise<Organization> => {
    const res = await api.get<{ success: boolean; data: Organization }>(`/api/orgs/${orgId}`);
    return res.data.data;
  },

  /**
   * PUT /api/orgs/:orgId/accept
   * Accept an invitation to join the organization.
   */
  acceptInvite: async (orgId: string): Promise<string> => {
    const res = await api.put<{ success: boolean; data: string }>(`/api/orgs/${orgId}/accept`);
    return res.data.data;
  },

  /**
   * GET /api/orgs/:orgId/members
   * List all members and pending invites for an organization. Requires accepted membership.
   */
  getOrgMembers: async (orgId: string): Promise<OrgMemberItem[]> => {
    const res = await api.get<{ success: boolean; data: OrgMemberItem[] }>(`/api/orgs/${orgId}/members`);
    return res.data.data;
  },

  /**
   * POST /api/orgs/:orgId/members
   * Invite a new user by email. Requires admin role.
   */
  inviteMember: async (orgId: string, email: string): Promise<string> => {
    const res = await api.post<{ success: boolean; data: string }>(`/api/orgs/${orgId}/members`, { email });
    return res.data.data;
  },

  /**
   * PUT /api/orgs/:orgId/members
   * Update a member's role (admin, employee, contributor). Requires admin role.
   */
  updateMemberRole: async (orgId: string, email: string, role: OrgRole): Promise<string> => {
    const res = await api.put<{ success: boolean; data: string }>(`/api/orgs/${orgId}/members`, { email, role });
    return res.data.data;
  },

  /**
   * DELETE /api/orgs/:orgId/members
   * Remove a member, revoke an invitation, or leave the organization.
   * Note: In Axios, DELETE body must be supplied in { data: { email } }.
   */
  removeMember: async (orgId: string, email: string): Promise<string> => {
    const res = await api.delete<{ success: boolean; data: string }>(`/api/orgs/${orgId}/members`, {
      data: { email }
    });
    return res.data.data;
  }
};
