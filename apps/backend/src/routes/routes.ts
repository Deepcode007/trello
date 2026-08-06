import { app } from "../..";
import { createBoard } from "../controllers/board/createBoard";
import { getBoardDetails } from "../controllers/board/getaBoard";
import { getAllBoards } from "../controllers/board/getBoards";
import { loginHandler } from "../controllers/loginHandler";
import { inviteUserHandler } from "../controllers/organisation/addUser";
import { OrgMembersHandler } from "../controllers/organisation/allMembers";
import { CreateOrgHandler } from "../controllers/organisation/Create";
import { DeleteOrgHandler } from "../controllers/organisation/deteleOrg";
import { getCurrentOrgs } from "../controllers/organisation/getCurrent";
import { getOrgDetails } from "../controllers/organisation/getDetails";
import { deleteUserHandler } from "../controllers/organisation/removeUser";
import { UpdateOrgHandler } from "../controllers/organisation/updateDetails";
import { updateRoleHandler } from "../controllers/organisation/updateRole";
import { profileHandler } from "../controllers/profileHandler";
import { signupHandler } from "../controllers/signupHandler";
import { asyncHandler } from "../helpers/asyncHandler";
import { auth } from "../middlewares/auth";

app.post("/api/auth/signup", asyncHandler(signupHandler));
app.post("/api/auth/login", asyncHandler(loginHandler));

app.use(auth);

app.get("/api/users/me", asyncHandler(profileHandler));

// Organizations & Memberships


// List all organizations the current user is a member of.
app.get("/api/orgs", asyncHandler(getCurrentOrgs));

// Create a new organization (name, description).
app.post("/api/orgs", asyncHandler(CreateOrgHandler));

// Get details of a specific organization.
app.post("/api/orgs/:orgId", asyncHandler(getOrgDetails));

// Update an organization's details.

app.put("/api/orgs/:orgId", asyncHandler(UpdateOrgHandler));

// Delete an organization.
app.delete("/api/orgs/:orgId", asyncHandler(DeleteOrgHandler));

// List all users and their roles in the organization.
app.get("/api/orgs/:orgId/members", asyncHandler(OrgMembersHandler));

// Add a user to an organization (requires userId and role).
app.post("/api/orgs/:orgId/members", asyncHandler(inviteUserHandler));

// Update a user's role (e.g., promote to admin). email, role in body
app.put("/api/orgs/:orgId/members/", asyncHandler(updateRoleHandler));

// Remove a user from an organization. (incl admin leave/remove). email in body
app.delete("/api/orgs/:orgId/members/", asyncHandler(deleteUserHandler));



// Boards

// List all boards within a specific organization.
app.get("/api/orgs/:orgId/boards", asyncHandler(getAllBoards));

// Create a new board (title) within an organization.
app.post("/api/orgs/:orgId/boards", asyncHandler(createBoard));

// Get board details, typically fetching sections and issues together.
app.get("/api/boards/:boardId", asyncHandler(getBoardDetails));


// Rename or update board details.
app.put("/api/boards/:boardId");

// Delete a board and its associated data.
app.delete("/api/boards/:boardId");


// Sections (Columns)

// List all sections for a specific board.
app.get("/api/boards/:boardId/sections");

// Create a new section (title) on a board.
app.post("/api/boards/:boardId/sections");

// Rename a specific section.
app.put("/api/sections/:sectionId");

// Delete a section (and handle/reassign orphaned issues).
app.delete("/api/sections/:sectionId");


// Issues (Cards)


// List all issues within a specific section.
app.get("/api/sections/:sectionId/issues");

// Create a new issue (title, description, boardId).
app.post("/api/sections/:sectionId/issues");

// 	Get full details of a specific issue.
app.get("/api/issues/:issueId");

// Update an issue (edit text, or move to a new sectionId).
app.put("/api/issues/:issueId");

// Delete an issue.
app.delete("/api/issues/:issueId");


// Issue Assignments & Comments


// Assign a user to an issue (creates issues_mapping record).
app.post("/api/issues/:issueId/assignees");

// Remove a user's assignment from an issue.
app.delete("/api/issues/:issueId/assignees/:userId");

// List all comments on a specific issue.
app.get("/api/issues/:issueId/comments");

// Add a comment to an issue (tied to the current user).
app.post("/api/issues/:issueId/comments");

// Edit a specific comment.
app.put("/api/comments/:commentId");

// Delete a comment.
app.delete("/api/comments/:commentId");


