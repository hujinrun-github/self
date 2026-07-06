import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MediaMap } from "../../lib/types";
import { renderWithApp } from "../../test/render";
import { MarkdownView } from "./MarkdownView";

const media: MediaMap = {
  "42": {
    content: {
      url: "/media/42/content",
      width: 1600,
      height: 900,
      mime_type: "image/jpeg",
    },
  },
  "201": {
    original: {
      url: "/media/201/original",
      mime_type: "audio/mpeg",
    },
  },
  "202": {
    original: {
      url: "/media/202/original",
      mime_type: "video/mp4",
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
    expect(image).toHaveAttribute("src", "/media/42/content");
    expect(image).toHaveAttribute("width", "1600");
    expect(image).toHaveAttribute("height", "900");
  });

  it("resolves audio media links before safe-link validation", () => {
    renderWithApp(
      <MarkdownView markdown={"[podcast](media://asset/201/original)"} media={media} />,
    );
    expect(screen.getByText("podcast").closest("a")).toHaveAttribute(
      "href",
      "/media/201/original",
    );
  });

  it("resolves video media links before safe-link validation", () => {
    renderWithApp(<MarkdownView markdown={"[demo](media://asset/202/original)"} media={media} />);
    expect(screen.getByText("demo").closest("a")).toHaveAttribute(
      "href",
      "/media/202/original",
    );
  });
});
