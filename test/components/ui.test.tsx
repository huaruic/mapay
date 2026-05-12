import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BadgeCheck } from "lucide-react";
import {
  Field,
  Metric,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  StatusPill,
} from "@/components/ui";

describe("<Metric>", () => {
  it("renders label, value, and the icon SVG", () => {
    const { container } = render(
      <Metric label="Tool calls" value="220" icon={BadgeCheck} />,
    );
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
    expect(screen.getByText("220")).toBeInTheDocument();
    // lucide icons render as <svg>.
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("<PrimaryButton>", () => {
  it("renders as a <button> with its children", () => {
    render(<PrimaryButton>Click</PrimaryButton>);
    const btn = screen.getByRole("button", { name: "Click" });
    expect(btn.tagName).toBe("BUTTON");
  });
});

describe("<SecondaryButton>", () => {
  it("renders as a <button> with its children", () => {
    render(<SecondaryButton>Withdraw</SecondaryButton>);
    const btn = screen.getByRole("button", { name: "Withdraw" });
    expect(btn.tagName).toBe("BUTTON");
  });
});

describe("<StatusPill>", () => {
  it("renders its text", () => {
    render(<StatusPill>Active</StatusPill>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});

describe("<Field>", () => {
  it("default mode renders an <input> with the label and default value", () => {
    render(<Field label="Agent name" value="Marketing Agent" />);
    expect(screen.getByText("Agent name")).toBeInTheDocument();
    const input = screen.getByDisplayValue("Marketing Agent");
    expect(input.tagName).toBe("INPUT");
  });

  it("multiline mode renders a <textarea> with the default value", () => {
    render(<Field label="Schema" multiline value="{topic: string}" />);
    const textarea = screen.getByDisplayValue("{topic: string}");
    expect(textarea.tagName).toBe("TEXTAREA");
  });
});

describe("<SectionTitle>", () => {
  it("renders both the eyebrow label and the heading title", () => {
    render(<SectionTitle label="EYE" title="HEAD" />);
    expect(screen.getByText("EYE")).toBeInTheDocument();
    expect(screen.getByText("HEAD")).toBeInTheDocument();
  });
});
