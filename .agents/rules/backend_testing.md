---
name: backend-testing-conventions
description: Guidelines and architectural style for writing tests in apps/backend
trigger:
  glob: "apps/backend/tests/**"
---

# Backend Testing Conventions

When adding or updating tests in `apps/backend`:

1. **Modular Test Architecture**:
   - Organize test suites under domain directories (`organization/`, `boards/`, `sections/`, `issues/`, `comments/`).
   - Group related endpoints or operations into individual test files containing exported runner functions (e.g. `export function rename_board_test()`).
   - Aggregate sub-suites in a top-level `<domain>.test.ts` file using `describe("<Domain> Tests", () => { describe("<Action>", action_test); })`.

2. **Helpers and Fixtures**:
   - Reuse existing helpers from `tests/helpers/` (`create_user`, `login_user`, `create_org`, `invite_user`, `accept_invite`, `create_boards`, `create_sections`, `create_issue`).
   - Isolate test entities using unique UUIDs/random strings (e.g., `crypto.randomUUID()`) to avoid database state collisions.

3. **HTTP and Authorization Matrix**:
   - Test endpoints across all permission levels: unauthenticated (401), invalid UUIDs/bad payloads (400), non-existent resources (404), non-members (403), unauthorized roles (contributor vs employee vs admin), and authorized success cases.

4. **TypeScript Safety**:
   - Strongly type or cast parsed JSON payloads from `await res.json()` (`as { success: boolean; data: ... }`) so `tsc --noEmit` and `check-types` always pass without errors.
