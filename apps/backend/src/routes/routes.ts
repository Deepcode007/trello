import { app } from "../..";
import { createBoard } from "../controllers/board/createBoard";
import { deleteBoard } from "../controllers/board/deleteBoard";
import { getBoardDetails } from "../controllers/board/getaBoard";
import { getAllBoards } from "../controllers/board/getBoards";
import { renameBoard } from "../controllers/board/renameBoard";
import { addComment } from "../controllers/comments/addComment";
import { getAllComments } from "../controllers/comments/getAllcomments";
import { assignIssue } from "../controllers/issues/assignIssue";
import { createIssue } from "../controllers/issues/createIssue";
import { deleteIssue } from "../controllers/issues/deleteIssue";
import { getAllIssues } from "../controllers/issues/getAllIssues";
import { issueDetail } from "../controllers/issues/issueDetail";
import { removeAssignment } from "../controllers/issues/removeAssignment";
import { updateIssue } from "../controllers/issues/updateIssue";
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
import { createSection } from "../controllers/sections/createSection";
import { deleteSection } from "../controllers/sections/deleteSection";
import { getAllSections } from "../controllers/sections/getAllSections";
import { renameSection } from "../controllers/sections/renameSectioon";
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
app.put("/api/boards/:boardId", asyncHandler(renameBoard));

// Delete a board and its associated data.
app.delete("/api/boards/:boardId", asyncHandler(deleteBoard));


// Sections (Columns)

// List all sections for a specific board.
app.get("/api/boards/:boardId/sections", asyncHandler(getAllSections));

// Create a new section (title) on a board.
app.post("/api/boards/:boardId/sections", asyncHandler(createSection));

// Rename a specific section.
app.put("/api/sections/:sectionId", asyncHandler(renameSection));

// Delete a section (and handle/reassign orphaned issues). admin only
app.delete("/api/sections/:sectionId", asyncHandler(deleteSection));


// Issues (Cards)


// List all issues within a specific section.
app.get("/api/sections/:sectionId/issues", asyncHandler(getAllIssues));

// Create a new issue (title, boardId).
app.post("/api/sections/:sectionId/issues", asyncHandler(createIssue));

// 	Get full details of a specific issue.
app.get("/api/issues/:issueId", asyncHandler(issueDetail));

// Update an issue (edit text, or move to a new sectionId).
app.put("/api/issues/:issueId", asyncHandler(updateIssue));

// Delete an issue.
app.delete("/api/issues/:issueId", asyncHandler(deleteIssue));


// Issue Assignments & Comments


// Assign a user to an issue (creates issues_mapping record).
// take emails of users => []
app.post("/api/issues/:issueId/assignees", asyncHandler(assignIssue));

// Remove a user's assignment from an issue. email in body
app.delete("/api/issues/:issueId/assignees/", asyncHandler(removeAssignment));

// List all comments on a specific issue.
app.get("/api/issues/:issueId/comments", asyncHandler(getAllComments));

// Add a comment to an issue (tied to the current user). (also possible for reply, parentId, desc in body)
app.post("/api/issues/:issueId/comments", asyncHandler(addComment));

// Edit a specific comment.
app.put("/api/comments/:commentId");

// Delete a comment.
app.delete("/api/comments/:commentId");


