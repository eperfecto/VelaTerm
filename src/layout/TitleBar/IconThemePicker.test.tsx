import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconThemePicker } from "./IconThemePicker";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));

describe("IconThemePicker", () => {
  it("marks the current theme and reports the chosen one", () => {
    const onChange = vi.fn();
    render(<IconThemePicker value="classic" onChange={onChange} />);
    const classic = screen.getByRole("button", { name: /settings\.iconThemeClassic/ });
    const fluent = screen.getByRole("button", { name: "settings.iconThemeFluent" });
    expect(classic.getAttribute("aria-pressed")).toBe("true");
    expect(fluent.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(fluent);
    expect(onChange).toHaveBeenCalledWith("fluent");
  });

  it("previews each option in its own theme", () => {
    render(<IconThemePicker value="classic" onChange={() => {}} />);
    const material = screen.getByRole("button", { name: /settings\.iconThemeMaterial/ });
    expect(material.querySelector("svg")?.getAttribute("viewBox")).toBe("0 -960 960 960");
  });
});
