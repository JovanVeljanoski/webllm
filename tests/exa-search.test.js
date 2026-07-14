import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ExaMcpSearchProvider,
  parseExaMcpResultText,
  parseMcpSseBody,
} from "../lib/exa-search.js";

describe("parseMcpSseBody", () => {
  it("parses SSE data lines", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n';
    const parsed = parseMcpSseBody(body);
    expect(parsed?.result?.content?.[0]?.text).toBe("ok");
  });

  it("parses plain JSON body", () => {
    const body = '{"jsonrpc":"2.0","id":1,"error":{"message":"fail"}}';
    expect(parseMcpSseBody(body)?.error?.message).toBe("fail");
  });

  it("returns null for empty input", () => {
    expect(parseMcpSseBody("")).toBeNull();
  });
});

describe("parseExaMcpResultText", () => {
  it("extracts title, url, and snippet blocks", () => {
    const text = `Title: Example
URL: https://example.com
Text: Hello world

Title: Other
URL: https://other.test
Highlights:
snippet line`;
    const rows = parseExaMcpResultText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Example",
      url: "https://example.com",
      snippet: "Hello world",
    });
    expect(rows[1].url).toBe("https://other.test");
  });

  it("strips control tokens from snippets", () => {
    const text = `Title: X
URL: https://x.test
Text: bad <|tool_call> token`;
    expect(parseExaMcpResultText(text)[0].snippet).not.toContain("<|tool_call>");
  });
});

describe("ExaMcpSearchProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls Exa MCP and formats results", async () => {
    const sse = `data: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{
          type: "text",
          text: "Title: Doc\nURL: https://doc.test\nText: Summary here",
        }],
      },
    })}\n\n`;

    fetch.mockResolvedValue({
      ok: true,
      text: async () => sse,
    });

    const provider = new ExaMcpSearchProvider("https://mcp.exa.ai/mcp");
    const out = await provider.search("test query");

    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("web_search_exa");
    expect(body.params.arguments.query).toBe("test query");
    expect(body.params.arguments).not.toHaveProperty("contextMaxCharacters");

    expect(out.rawProvider).toBe("exa-mcp");
    expect(out.results).toHaveLength(1);
    expect(out.formatted).toContain("[1] Doc");
    expect(out.formatted).toContain("https://doc.test");
  });

  it("throws on HTTP errors", async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => "unavailable" });
    const provider = new ExaMcpSearchProvider();
    await expect(provider.search("q")).rejects.toThrow(/Exa MCP HTTP 503/);
  });

  it("throws on MCP tool errors", async () => {
    const sse = `data: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { isError: true, content: [{ type: "text", text: "rate limited" }] },
    })}\n\n`;
    fetch.mockResolvedValue({ ok: true, text: async () => sse });
    const provider = new ExaMcpSearchProvider();
    await expect(provider.search("q")).rejects.toThrow("rate limited");
  });
});
