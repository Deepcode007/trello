import { describe } from "bun:test";
import { create_section_test } from "./create_section";
import { get_sections_test } from "./get_sections";
import { rename_section_test } from "./rename_section";
import { delete_section_test } from "./delete_section";

describe("Sections Tests", () =>
{
    describe("Create new section", create_section_test);
    describe("List all sections for a board", get_sections_test);
    describe("Rename a section", rename_section_test);
    describe("Delete a section", delete_section_test);
});
