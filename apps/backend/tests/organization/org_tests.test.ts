import { describe } from "bun:test";
import { getAllorgs } from "./get_org.test.ts";
import { update_orgs } from "./update_org.test.ts";

describe("Organization tests", async () =>
{
    describe("Get & create organizations", getAllorgs);
    describe("Update organizations", update_orgs);
})