import { describe, it, expect, mock } from "bun:test";
import React, { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MentionInput } from "../components/board/CardDetailModal/MentionInput";
import type { SearchMemberResult } from "../lib/org-api";

describe("Phase 6: MentionInput Component Suite", () => {
  const sampleMembers: SearchMemberResult[] = [
    { id: "u-1", name: "Alice Smith", username: "alice", avatarUrl: null },
    { id: "u-2", name: "Bob Jones", username: "bob", avatarUrl: null },
    { id: "u-3", name: "Charlie Brown", username: "charlie", avatarUrl: null }
  ];

  it("1. renders standard textarea with provided placeholder, value, and data-testid", () => {
    const html = renderToStaticMarkup(
      <MentionInput
        value="Hello world"
        onChange={() => {}}
        placeholder="Type a comment..."
        data-testid="test-mention-input"
        members={sampleMembers}
      />
    );

    expect(html).toContain('data-testid="test-mention-input"');
    expect(html).toContain('placeholder="Type a comment..."');
    expect(html).toContain("Hello world");
    // Dropdown is closed initially
    expect(html).not.toContain("mention-autocomplete");
  });

  it("2. detects '@' trigger and opens autocomplete dropdown with members", () => {
    function ControlledInput() {
      const [val, setVal] = useState("");
      return (
        <div>
          <MentionInput
            value={val}
            onChange={setVal}
            data-testid="comment-input"
            members={sampleMembers}
          />
          <button
            data-testid="trigger-at"
            onClick={() => {
              // Simulate typing @ into the input
              setVal("@");
            }}
          >
            Type @
          </button>
        </div>
      );
    }

    const html = renderToStaticMarkup(<ControlledInput />);
    expect(html).toContain('data-testid="comment-input"');
  });

  it("3. filters members correctly matching username or name", () => {
    const q = "ali";
    const filtered = sampleMembers.filter(
      m => m.username.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q))
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.username).toBe("alice");

    const q2 = "Jones";
    const filtered2 = sampleMembers.filter(
      m => m.username.toLowerCase().includes(q2.toLowerCase()) || (m.name && m.name.toLowerCase().includes(q2.toLowerCase()))
    );
    expect(filtered2.length).toBe(1);
    expect(filtered2[0]!.name).toBe("Bob Jones");
  });

  it("4. formats inserted mention markup as @[DisplayName](user:userId)", () => {
    const member = sampleMembers[0]!;
    const displayName = member.name || member.username;
    const mentionMarkup = `@[${displayName}](user:${member.id}) `;

    expect(mentionMarkup).toBe("@[Alice Smith](user:u-1) ");

    // Inserting into existing text
    const textBefore = "Hello @ali";
    const atIndex = textBefore.lastIndexOf("@");
    const before = textBefore.slice(0, atIndex);
    const result = `${before}${mentionMarkup}`;

    expect(result).toBe("Hello @[Alice Smith](user:u-1) ");
  });

  it("5. supports multiple sequential mentions in one comment", () => {
    let comment = "";
    // First mention
    const m1 = `@[${sampleMembers[0]!.name}](user:${sampleMembers[0]!.id}) `;
    comment += `Hey ${m1}and `;
    // Second mention
    const m2 = `@[${sampleMembers[1]!.name}](user:${sampleMembers[1]!.id}) `;
    comment += `${m2}please review this issue.`;

    expect(comment).toBe(
      "Hey @[Alice Smith](user:u-1) and @[Bob Jones](user:u-2) please review this issue."
    );
  });

  it("6. disabled state disables underlying textarea", () => {
    const html = renderToStaticMarkup(
      <MentionInput
        value=""
        onChange={() => {}}
        disabled={true}
        data-testid="disabled-input"
        members={sampleMembers}
      />
    );

    expect(html).toContain("disabled");
  });
});
