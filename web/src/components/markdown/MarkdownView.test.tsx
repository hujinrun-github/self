import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

afterEach(() => {
  cleanup();
});

describe("MarkdownView", () => {
  it("does not render raw HTML", () => {
    renderWithApp(<MarkdownView markdown={"Hello <script>alert(1)</script>"} media={{}} />);
    expect(screen.queryByText("alert(1)")).not.toBeInTheDocument();
  });

  it("removes javascript links", () => {
    renderWithApp(<MarkdownView markdown={"[bad](javascript:alert(1))"} media={{}} />);
    expect(screen.getByText("bad").closest("a")).not.toHaveAttribute("href");
  });

  it("renders safe remote images", () => {
    renderWithApp(
      <MarkdownView markdown={"![remote](https://example.com/a.png)"} media={{}} />,
    );
    const image = screen.getByRole("img", { name: "remote" });
    expect(image).toHaveAttribute("src", "https://example.com/a.png");
    expect(image).toHaveAttribute("referrerPolicy", "no-referrer");
  });

  it("previews images when pasted markdown splits the label and url across lines", () => {
    renderWithApp(
      <MarkdownView markdown={"![remote]\n(https://example.com/a.png)"} media={{}} />,
    );
    expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute(
      "src",
      "https://example.com/a.png",
    );
  });

  it("applies heading anchors in markdown order", () => {
    renderWithApp(
      <MarkdownView
        headingIDs={["first-heading", "second-heading"]}
        markdown={"# First heading\n\n## Second heading"}
        media={{}}
      />,
    );

    expect(screen.getByRole("heading", { name: "First heading" })).toHaveAttribute(
      "id",
      "first-heading",
    );
    expect(screen.getByRole("heading", { name: "Second heading" })).toHaveAttribute(
      "id",
      "second-heading",
    );
  });

  it("rejects unsafe remote images", () => {
    const { container } = renderWithApp(
      <MarkdownView markdown={"![unsafe](javascript:alert(1))"} media={{}} />,
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
