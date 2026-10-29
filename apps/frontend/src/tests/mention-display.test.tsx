import { describe, it, expect } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MentionDisplay } from "../components/board/CardDetailModal/MentionDisplay";

describe("Phase 6: MentionDisplay Component Suite", () => {
  it("renders normal text correctly without crashing or modifying content", () => {
    const text = "This is a regular comment with no mentions.";
    const html = renderToStaticMarkup(<MentionDisplay content={text} />);

    expect(html).toContain("This is a regular comment with no mentions.");
    expect(html).not.toContain("mention-badge");
  });

  it("visually distinguishes a single mention with badge and user id", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const text = `Hello @[Alice Smith](user:${userId}), please review this card.`;
    const html = renderToStaticMarkup(<MentionDisplay content={text} />);

    expect(html).toContain("Hello ");
    expect(html).toContain(", please review this card.");
    expect(html).toContain('data-testid="mention-badge"');
    expect(html).toContain(`data-user-id="${userId}"`);
    expect(html).toContain("@Alice Smith");
    expect(html).toContain("text-primary");
    expect(html).toContain("bg-primary/10");
  });

  it("renders multiple distinct mentions across a comment correctly", () => {
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const text = `Hey @[Alice](user:${userA}) and @[Bob Jones](user:${userB}), look at this!`;
    const html = renderToStaticMarkup(<MentionDisplay content={text} />);

    expect(html).toContain("@Alice");
    expect(html).toContain("@Bob Jones");
    expect(html).toContain(`data-user-id="${userA}"`);
    expect(html).toContain(`data-user-id="${userB}"`);
  });

  it("handles usernames/display names with special characters and spaces", () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    const text = `CC: @[Dr. René / $pecial (Lead)](user:${userId})`;
    const html = renderToStaticMarkup(<MentionDisplay content={text} />);

    expect(html).toContain("@Dr. René / $pecial (Lead)");
    expect(html).toContain(`data-user-id="${userId}"`);
  });

  it("gracefully handles malformed mention syntax as plain text without crashing", () => {
    const malformed = "Hey @[Incomplete(user:123) and @[Empty]() and @Alice without markup";
    const html = renderToStaticMarkup(<MentionDisplay content={malformed} />);

    expect(html).toContain("Hey @[Incomplete(user:123) and @[Empty]() and @Alice without markup");
    expect(html).not.toContain("mention-badge");
  });

  it("handles null, undefined, and empty string content cleanly", () => {
    expect(renderToStaticMarkup(<MentionDisplay content="" />)).toBe("");
    expect(renderToStaticMarkup(<MentionDisplay content={null as any} />)).toBe("");
    expect(renderToStaticMarkup(<MentionDisplay content={undefined as any} />)).toBe("");
  });

  it("preserves whitespace and newlines for multiline comments", () => {
    const multiline = "Line 1\nLine 2 @[Alice](user:11111111-1111-4111-8111-111111111111)\nLine 3";
    const html = renderToStaticMarkup(<MentionDisplay content={multiline} />);

    expect(html).toContain("Line 1\nLine 2 ");
    expect(html).toContain("\nLine 3");
    expect(html).toContain("whitespace-pre-wrap");
  });
});
