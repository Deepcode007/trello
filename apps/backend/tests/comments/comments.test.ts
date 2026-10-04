import { describe } from "bun:test";
import { add_comment_test } from "./add_comment";
import { get_comments_test } from "./get_comments";
import { edit_comment_test } from "./edit_comment";
import { delete_comment_test } from "./delete_comment";

describe("Comments Tests", () =>
{
    describe("Add comment and replies", add_comment_test);
    describe("Get comments tree for an issue", get_comments_test);
    describe("Edit comment", edit_comment_test);
    describe("Delete comment", delete_comment_test);
});
