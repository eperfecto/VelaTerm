import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { setLang } from "../../../i18n";
import { MessageBubble } from "./rows";

vi.mock("../../../platform/env", () => ({ env: { isTauri: false, isElectron: false, isWeb: true } }));

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the report`).join("\n\n");
const content = (container: HTMLElement) => container.querySelector(".sv-message-clip")!;

beforeEach(() => setLang("en"));
afterEach(cleanup);

it("shows a long message from another session collapsed until it is expanded, and collapses it again", () => {
  const { container } = render(<MessageBubble who="Worker" isUser collapsible text={LONG} />);
  expect(content(container).classList.contains("sv-message-collapsed")).toBe(true);
  // The whole text stays in the page, so search and copy still find it.
  expect(container.textContent).toContain("Line 30 of the report");

  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(content(container).classList.contains("sv-message-collapsed")).toBe(false);
  expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "Show less" }));
  expect(content(container).classList.contains("sv-message-collapsed")).toBe(true);
});

it("leaves a short message from another session open with no toggle", () => {
  const { container } = render(<MessageBubble who="Worker" isUser collapsible text="Done: tests pass." />);
  expect(content(container).classList.contains("sv-message-collapsed")).toBe(false);
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});

it("keeps the user's own long messages open", () => {
  const { container } = render(<MessageBubble who="You" isUser text={LONG} />);
  expect(content(container).classList.contains("sv-message-collapsed")).toBe(false);
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});
