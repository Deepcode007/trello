import { describe, it, expect, afterEach, mock } from "bun:test";
import {
  orgApi,
  getOrgErrorMessage,
  type UserOrgMembership,
  type Organization,
  type OrgMemberItem,
  type OrgRole
} from "../lib/org-api";
import { api } from "../lib/api";

describe("org-api client and error parsing", () => {
  const originalGet = api.get;
  const originalPost = api.post;
  const originalPut = api.put;
  const originalDelete = api.delete;

  afterEach(() => {
    api.get = originalGet;
    api.post = originalPost;
    api.put = originalPut;
    api.delete = originalDelete;
  });

  describe("getOrgErrorMessage", () => {
    it("extracts response.data.error from Axios rejection object", () => {
      const err = {
        response: {
          status: 409,
          data: {
            success: false,
            error: "An organization with this name already exists"
          }
        }
      };
      expect(getOrgErrorMessage(err)).toBe("An organization with this name already exists");
    });

    it("extracts response.data.message when error property is absent", () => {
      const err = {
        response: {
          status: 400,
          data: {
            message: "Validation failed: Organization name is required"
          }
        }
      };
      expect(getOrgErrorMessage(err)).toBe("Validation failed: Organization name is required");
    });

    it("prefers response.data.error over response.data.message when both are present", () => {
      const err = {
        response: {
          status: 403,
          data: {
            error: "Cannot demote the last remaining admin",
            message: "Forbidden access"
          }
        }
      };
      expect(getOrgErrorMessage(err)).toBe("Cannot demote the last remaining admin");
    });

    it("falls back to top-level err.message when response.data has no error or message string", () => {
      const err = new Error("Network Error: Connection refused");
      expect(getOrgErrorMessage(err)).toBe("Network Error: Connection refused");
    });

    it("falls back to default fallbackMessage when err is an empty object", () => {
      expect(getOrgErrorMessage({})).toBe("An unexpected error occurred");
    });

    it("respects custom fallbackMessage parameter when error cannot be extracted", () => {
      expect(getOrgErrorMessage({}, "Custom fallback failure")).toBe("Custom fallback failure");
    });

    it("handles primitive and nullish inputs safely", () => {
      expect(getOrgErrorMessage(null)).toBe("An unexpected error occurred");
      expect(getOrgErrorMessage(undefined)).toBe("An unexpected error occurred");
      expect(getOrgErrorMessage("string error")).toBe("An unexpected error occurred");
      expect(getOrgErrorMessage(500)).toBe("An unexpected error occurred");
      expect(getOrgErrorMessage(false, "Failed to load")).toBe("Failed to load");
    });

    it("handles response.data where error is a non-string object/number and falls back to err.message", () => {
      const err = {
        response: {
          data: {
            error: { code: "ORG_NOT_FOUND" }
          }
        },
        message: "Request failed with status code 404"
      };
      expect(getOrgErrorMessage(err)).toBe("Request failed with status code 404");
    });
  });

  describe("getUserOrgs (GET /api/orgs)", () => {
    it("fetches memberships list successfully", async () => {
      const mockMemberships: UserOrgMembership[] = [
        {
          id: "m-1",
          role: "admin",
          accepted: true,
          userId: "u-1",
          orgId: "org-1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          acceptedAt: "2026-01-01T00:00:00Z",
          org: {
            id: "org-1",
            name: "Acme Corp",
            description: "Main workspace",
            visible: true,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z"
          }
        },
        {
          id: "m-2",
          role: "contributor",
          accepted: false,
          userId: "u-1",
          orgId: "org-2",
          createdAt: "2026-02-01T00:00:00Z",
          updatedAt: "2026-02-01T00:00:00Z",
          acceptedAt: null,
          org: {
            id: "org-2",
            name: "Beta Labs",
            description: "Experimental group",
            visible: false,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z"
          }
        }
      ];

      let requestedUrl = "";
      api.get = mock((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          data: {
            success: true,
            data: mockMemberships
          }
        });
      }) as unknown as typeof api.get;

      const result = await orgApi.getUserOrgs();
      expect(requestedUrl).toBe("/api/orgs");
      expect(result).toEqual(mockMemberships);
      expect(result.length).toBe(2);
      expect(result[0]?.org.name).toBe("Acme Corp");
      expect(result[1]?.accepted).toBe(false);
    });

    it("propagates API rejection error", async () => {
      api.get = mock(() => {
        return Promise.reject(new Error("Network timeout"));
      }) as unknown as typeof api.get;

      let errorThrown: unknown;
      try {
        await orgApi.getUserOrgs();
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect((errorThrown as Error).message).toBe("Network timeout");
    });
  });

  describe("createOrg (POST /api/orgs)", () => {
    it("creates an organization with full payload including visible flag", async () => {
      const createdOrg: Organization = {
        id: "org-new",
        name: "New Startup",
        description: "Innovative product development",
        visible: true,
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z"
      };

      let sentUrl = "";
      let sentBody: unknown;

      api.post = mock((url: string, body: unknown) => {
        sentUrl = url;
        sentBody = body;
        return Promise.resolve({
          data: {
            success: true,
            data: createdOrg
          }
        });
      }) as unknown as typeof api.post;

      const payload = {
        name: "New Startup",
        description: "Innovative product development",
        visible: true
      };

      const result = await orgApi.createOrg(payload);
      expect(sentUrl).toBe("/api/orgs");
      expect(sentBody).toEqual(payload);
      expect(result).toEqual(createdOrg);
      expect(result.id).toBe("org-new");
    });

    it("creates an organization without optional visible flag", async () => {
      let sentBody: unknown;
      api.post = mock((_url: string, body: unknown) => {
        sentBody = body;
        return Promise.resolve({
          data: {
            success: true,
            data: { id: "org-default-vis", name: "Org", description: "Desc", visible: true, createdAt: "", updatedAt: "" }
          }
        });
      }) as unknown as typeof api.post;

      await orgApi.createOrg({ name: "Org", description: "Desc" });
      expect(sentBody).toEqual({ name: "Org", description: "Desc" });
    });

    it("propagates 409 conflict error when org name already exists", async () => {
      api.post = mock(() => {
        const error = Object.assign(new Error("Request failed with status code 409"), {
          response: {
            status: 409,
            data: { success: false, error: "An organization with this name already exists" }
          }
        });
        return Promise.reject(error);
      }) as unknown as typeof api.post;

      let caught: unknown;
      try {
        await orgApi.createOrg({ name: "Duplicate", description: "Desc" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(getOrgErrorMessage(caught)).toBe("An organization with this name already exists");
    });
  });

  describe("getOrgDetails (GET /api/orgs/:orgId)", () => {
    it("fetches single organization details by orgId", async () => {
      const mockOrg: Organization = {
        id: "org-123",
        name: "Engineering Division",
        description: "Core platforms",
        visible: true,
        createdAt: "2026-01-10T00:00:00Z",
        updatedAt: "2026-01-15T00:00:00Z"
      };

      let requestedUrl = "";
      api.get = mock((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          data: {
            success: true,
            data: mockOrg
          }
        });
      }) as unknown as typeof api.get;

      const result = await orgApi.getOrgDetails("org-123");
      expect(requestedUrl).toBe("/api/orgs/org-123");
      expect(result.id).toBe("org-123");
      expect(result.name).toBe("Engineering Division");
    });

    it("propagates 404 when org does not exist or user lacks permission", async () => {
      api.get = mock(() => {
        const err = Object.assign(new Error("Not Found"), {
          response: {
            status: 404,
            data: { success: false, error: "Organization not found" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.get;

      let caught: unknown;
      try {
        await orgApi.getOrgDetails("missing-org");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("Organization not found");
    });
  });

  describe("acceptInvite (PUT /api/orgs/:orgId/accept)", () => {
    it("submits PUT to accept invite endpoint", async () => {
      let requestedUrl = "";
      api.put = mock((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          data: {
            success: true,
            data: "Invitation accepted successfully"
          }
        });
      }) as unknown as typeof api.put;

      const result = await orgApi.acceptInvite("target-org-id");
      expect(requestedUrl).toBe("/api/orgs/target-org-id/accept");
      expect(result).toBe("Invitation accepted successfully");
    });

    it("propagates error when invite token or membership is invalid", async () => {
      api.put = mock(() => {
        const err = Object.assign(new Error("Bad Request"), {
          response: {
            status: 400,
            data: { success: false, error: "Invitation expired or invalid" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.put;

      let caught: unknown;
      try {
        await orgApi.acceptInvite("bad-org");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("Invitation expired or invalid");
    });
  });

  describe("getOrgMembers (GET /api/orgs/:orgId/members)", () => {
    it("retrieves list of organization members and invited users", async () => {
      const mockMembers: OrgMemberItem[] = [
        {
          role: "admin",
          accepted: true,
          orgId: "org-1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          acceptedAt: "2026-01-01T00:00:00Z",
          user: {
            username: "admin_user",
            email: "admin@example.com"
          }
        },
        {
          role: "employee",
          accepted: true,
          orgId: "org-1",
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
          acceptedAt: "2026-01-05T00:00:00Z",
          user: {
            username: "dev_user",
            email: "dev@example.com"
          }
        },
        {
          role: "contributor",
          accepted: false,
          orgId: "org-1",
          createdAt: "2026-02-10T00:00:00Z",
          updatedAt: "2026-02-10T00:00:00Z",
          acceptedAt: null,
          user: {
            username: "invited_guest",
            email: "guest@example.com"
          }
        }
      ];

      let requestedUrl = "";
      api.get = mock((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          data: {
            success: true,
            data: mockMembers
          }
        });
      }) as unknown as typeof api.get;

      const members = await orgApi.getOrgMembers("org-1");
      expect(requestedUrl).toBe("/api/orgs/org-1/members");
      expect(members.length).toBe(3);
      expect(members[0]?.user.email).toBe("admin@example.com");
      expect(members[2]?.accepted).toBe(false);
    });

    it("propagates 403 when user is not a member of the organization", async () => {
      api.get = mock(() => {
        const err = Object.assign(new Error("Forbidden"), {
          response: {
            status: 403,
            data: { success: false, error: "You must be an accepted member to view organization members" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.get;

      let caught: unknown;
      try {
        await orgApi.getOrgMembers("forbidden-org");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("You must be an accepted member to view organization members");
    });
  });

  describe("inviteMember (POST /api/orgs/:orgId/members)", () => {
    it("submits POST to invite member by email", async () => {
      let requestedUrl = "";
      let sentBody: unknown;

      api.post = mock((url: string, body: unknown) => {
        requestedUrl = url;
        sentBody = body;
        return Promise.resolve({
          data: {
            success: true,
            data: "Invitation sent successfully"
          }
        });
      }) as unknown as typeof api.post;

      const result = await orgApi.inviteMember("org-42", "newguy@example.com");
      expect(requestedUrl).toBe("/api/orgs/org-42/members");
      expect(sentBody).toEqual({ email: "newguy@example.com" });
      expect(result).toBe("Invitation sent successfully");
    });

    it("propagates 404 when invited email has not registered an account", async () => {
      api.post = mock(() => {
        const err = Object.assign(new Error("Not Found"), {
          response: {
            status: 404,
            data: { success: false, error: "User not signed up" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.post;

      let caught: unknown;
      try {
        await orgApi.inviteMember("org-42", "unregistered@example.com");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("User not signed up");
    });

    it("propagates 409 when user is already a member", async () => {
      api.post = mock(() => {
        const err = Object.assign(new Error("Conflict"), {
          response: {
            status: 409,
            data: { success: false, error: "User already member" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.post;

      let caught: unknown;
      try {
        await orgApi.inviteMember("org-42", "existing@example.com");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("User already member");
    });
  });

  describe("updateMemberRole (PUT /api/orgs/:orgId/members)", () => {
    it("submits PUT to update member role", async () => {
      let requestedUrl = "";
      let sentBody: unknown;

      api.put = mock((url: string, body: unknown) => {
        requestedUrl = url;
        sentBody = body;
        return Promise.resolve({
          data: {
            success: true,
            data: "Role updated successfully"
          }
        });
      }) as unknown as typeof api.put;

      const result = await orgApi.updateMemberRole("org-42", "member@example.com", "employee" as OrgRole);
      expect(requestedUrl).toBe("/api/orgs/org-42/members");
      expect(sentBody).toEqual({ email: "member@example.com", role: "employee" });
      expect(result).toBe("Role updated successfully");
    });

    it("propagates 403 when attempting to demote the last admin", async () => {
      api.put = mock(() => {
        const err = Object.assign(new Error("Forbidden"), {
          response: {
            status: 403,
            data: { success: false, error: "Cannot demote the last remaining admin" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.put;

      let caught: unknown;
      try {
        await orgApi.updateMemberRole("org-42", "lastadmin@example.com", "contributor");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("Cannot demote the last remaining admin");
    });
  });

  describe("removeMember (DELETE /api/orgs/:orgId/members)", () => {
    it("submits DELETE with email wrapped in request body config ({ data: { email } })", async () => {
      let requestedUrl = "";
      let sentConfig: unknown;

      api.delete = mock((url: string, config?: unknown) => {
        requestedUrl = url;
        sentConfig = config;
        return Promise.resolve({
          data: {
            success: true,
            data: "User removed successfully"
          }
        });
      }) as unknown as typeof api.delete;

      const result = await orgApi.removeMember("org-99", "ex_employee@example.com");
      expect(requestedUrl).toBe("/api/orgs/org-99/members");
      // Must match Axios requirement: delete payload is passed under { data: { email } }
      expect(sentConfig).toEqual({
        data: { email: "ex_employee@example.com" }
      });
      expect(result).toBe("User removed successfully");
    });

    it("propagates 403 when attempting to remove the last remaining admin", async () => {
      api.delete = mock(() => {
        const err = Object.assign(new Error("Forbidden"), {
          response: {
            status: 403,
            data: { success: false, error: "Cannot remove the last remaining admin" }
          }
        });
        return Promise.reject(err);
      }) as unknown as typeof api.delete;

      let caught: unknown;
      try {
        await orgApi.removeMember("org-99", "soleadmin@example.com");
      } catch (err) {
        caught = err;
      }
      expect(getOrgErrorMessage(caught)).toBe("Cannot remove the last remaining admin");
    });
  });
});
