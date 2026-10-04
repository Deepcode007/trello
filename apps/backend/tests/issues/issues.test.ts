import { describe } from "bun:test";
import { create_issue_test } from "./create_issue";
import { get_issues_test } from "./get_issues";
import { issue_detail_test } from "./issue_detail";
import { update_issue_test } from "./update_issue";
import { delete_issue_test } from "./delete_issue";
import { assign_issue_test } from "./assign_issue";

describe("Issues Tests", () =>
{
    describe("Create new issue", create_issue_test);
    describe("List all issues in a section", get_issues_test);
    describe("Get issue detail", issue_detail_test);
    describe("Update issue", update_issue_test);
    describe("Delete issue", delete_issue_test);
    describe("Assign and unassign issue", assign_issue_test);
});
