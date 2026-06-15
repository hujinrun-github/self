import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MediaMap } from "../../lib/types";
import { renderWithApp } from "../../test/render";
import { MarkdownView } from "./MarkdownView";

const media: MediaMap = {
  "42": {
    content: {
      url: "/uploads/ab/cd/content.jpg",
      width: 1600,
      height: 900,
      mime_type: "image/jpeg",
    },
  },
};

describe("MarkdownView", () => {
  it("does not render raw HTML", () => {
    renderWithApp(<MarkdownView markdown={"Hello <script>alert(1)</script>"} media={{}} />);
    expect(screen.queryByText("alert(1)")).not.toBeInTheDocument();
  });

  it("removes javascript links", () => {
    renderWithApp(<MarkdownView markdown={"[bad](javascript:alert(1))"} media={{}} />);
    expect(screen.getByText("bad").closest("a")).not.toHaveAttribute("href");
  });

  it("rejects remote images", () => {
    const { container } = renderWithApp(
      <MarkdownView markdown={"![remote](https://example.com/a.png)"} media={{}} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("resolves media URLs through the media map", () => {
    renderWithApp(
      <MarkdownView markdown={"![cover](media://asset/42/content)"} media={media} />,
    );
    const image = screen.getByRole("img", { name: "cover" });
    expect(image).toHaveAttribute("src", "/uploads/ab/cd/content.jpg");
    expect(image).toHaveAttribute("width", "1600");
    expect(image).toHaveAttribute("height", "900");
  });
});
