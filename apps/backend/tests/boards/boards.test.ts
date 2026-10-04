import { describe } from "bun:test";
import { get_boards } from "./get_board";
import { create_board_test } from "./create_board";
import { get_boards_issue_sections } from "./get_boards_issue_sections";
import { rename_board_test } from "./rename_board";
import { delete_board_test } from "./delete_board";


describe("Boards Tests", () =>
{
    describe("List all Boards in an org", get_boards);
    describe("Create new board", create_board_test);
    describe("Get board details with issues and sections", get_boards_issue_sections);

    describe("Rename/update board", rename_board_test);
    describe("Delete board", delete_board_test);
})
