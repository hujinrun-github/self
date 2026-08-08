import http from "node:http";

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    const payload = JSON.parse(body);
    const userContent = payload.messages?.find((message) => message.role === "user")?.content ?? "{}";
    const source = JSON.parse(userContent).source ?? {};
    const generated = {
      title: "Intel Mac Cannot Find Xcode in the Apple Store",
      slug: "intel-mac-cannot-find-xcode-in-apple-store",
      excerpt: source.Excerpt ? "Translated article summary." : "",
      content_md: String(source.ContentMD ?? "")
        .replace("# 1.问题描述", "# 1. Problem Description")
        .replace("# 2.解决办法", "# 2. Solution")
        .replace("intel版本的mac，现在在apple store的商店直接搜索是无法找到xcode这个应用程序的", "On Intel-based Macs, Xcode can no longer be found by searching the Apple Store directly."),
      seo_title: "Intel Mac Cannot Find Xcode",
      seo_description: "How to download an older Xcode release for an Intel-based Mac.",
    };
    const completion = {
      choices: [{ message: { content: JSON.stringify(generated) } }],
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(completion));
  });
});

server.listen(19090, "127.0.0.1", () => {
  console.log("mock DeepSeek listening on http://127.0.0.1:19090");
});
