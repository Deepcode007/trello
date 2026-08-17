import { describe } from "bun:test";
import { getAllorgs } from "./get_org.ts";
import { update_orgs } from "./update_org.ts";
import { delete_org } from "./delete_org.ts";
import { add_remove_users_and_roles } from "./add_remove_user.ts";

describe("Organization tests", () =>
{
    describe("Get & create organizations", getAllorgs);
    describe("Update organizations", update_orgs);
    describe("Delete an Organization", delete_org);
    describe("Add user and remove user, update role", add_remove_users_and_roles);
})
