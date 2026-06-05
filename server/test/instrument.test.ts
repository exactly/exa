import { close, flush, getActiveSpan, init, startSpan } from "@sentry/node";
import { createServer } from "node:http";
import { connect } from "node:net";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import config from "../instrument.cjs";

afterAll(() => close());

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrument", () => {
  it("adds the cloud run service to transaction names", async () => {
    const transactions: string[] = [];
    init({
      ...config,
      dsn: "https://key@example.com/1",
      integrations: [],
      transport: () => ({
        send: (envelope) => {
          transactions.push(
            ...envelope[1]
              .filter(([header]) => header.type === "transaction")
              .map(([, event]) => JSON.stringify(event)),
          );
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });

    vi.stubEnv("K_SERVICE", "");
    expect(startSpan({ name: "exa.execute", op: "exa.execute" }, (span) => span.isRecording())).toBe(true);
    await flush(1000);
    vi.stubEnv("K_SERVICE", "sandbox-chat");
    expect(startSpan({ name: "exa.execute", op: "exa.execute" }, (span) => span.isRecording())).toBe(true);
    await flush(1000);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toContain('"transaction":"exa.execute"');
    expect(transactions[1]).toContain('"transaction":"exa.execute · sandbox-chat"');
  });

  it("traces nonempty block requests but drops empty block and frontend traces", async () => {
    const traces: unknown[] = [];
    init({
      ...config,
      dsn: "https://key@example.com/1",
      transport: () => ({
        send: (envelope) => {
          traces.push(...envelope[1].filter(([header]) => header.type === "transaction" || header.type === "span"));
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += String(chunk)));
      request.resume();
      request.on("end", () => {
        if (request.url === "/hooks/block" && body === '{"logs":[]}') {
          getActiveSpan()?.setAttribute("exa.ignore", true);
        }
        response.setHeader("Set-Cookie", ["credential_id=server-secret; HttpOnly", "theme=dark"]);
        response.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const request = (path: string, body = "") =>
      new Promise<void>((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1");
        socket.on("error", reject);
        socket.on("data", () => undefined);
        socket.on("end", resolve);
        socket.on("connect", () =>
          socket.end(
            `${body ? "POST" : "GET"} ${path} HTTP/1.1\r\nHost: localhost\r\nCookie: credential_id=credential-secret; session_id=challenge-secret; __Secure-better-auth.session_token=auth-secret; theme=dark\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          ),
        );
      });
    try {
      await request("/assets/app.js");
      await flush(1000);
      expect(traces).toHaveLength(0);
      await request("/hooks/block", JSON.stringify({ logs: [] }));
      await flush(1000);
      expect(traces).toHaveLength(0);
      await request("/hooks/block", JSON.stringify({ logs: [1] }));
      await flush(1000);
      expect(traces).toHaveLength(1);
      expect(JSON.stringify(traces)).toContain('"op":"http.server"');
      await request("/api/card");
      await flush(1000);
      expect(traces).toHaveLength(2);
      await request("/api?card");
      await flush(1000);
      expect(traces).toHaveLength(3);
      await request("/apiary");
      await flush(1000);
      expect(traces).toHaveLength(3);
      expect(JSON.stringify(traces)).not.toMatch(/credential-secret|challenge-secret|auth-secret|server-secret/);
      expect(JSON.stringify(traces)).toContain("theme=dark");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
