import { createServer } from "node:http";
import type { Server } from "node:http";

export type LoopbackCallback = Readonly<{
  awaitCode: () => Promise<string>;
  close: () => Promise<void>;
  redirectUri: string;
}>;

const closeServer = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
});

const callbackResponse = (status: number, body: string): Readonly<{ body: string; headers: Readonly<Record<string, string>>; status: number }> => ({
  body,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  status,
});

/** Opens one IPv4 loopback callback listener and resolves only a matching OAuth authorization response. */
export const openLoopbackCallback = async (state: string): Promise<LoopbackCallback> => {
  const result = await new Promise<Readonly<{ code: Promise<string>; server: Server }>>((resolve, reject) => {
    const code = new Promise<string>((resolveCode, rejectCode) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const authorizationCode = url.searchParams.get("code");
        const callbackState = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const outcome = error || !authorizationCode || callbackState !== state
          ? callbackResponse(400, "<p>BizYeet authorization could not be completed. Return to the CLI.</p>")
          : callbackResponse(200, "<p>BizYeet authorization is complete. You can return to the CLI.</p>");
        response.writeHead(outcome.status, outcome.headers).end(outcome.body);
        if (error) rejectCode(new Error("OAuth authorization was denied."));
        else if (!authorizationCode || callbackState !== state) rejectCode(new Error("OAuth authorization callback did not match this login."));
        else resolveCode(authorizationCode);
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        resolve({ code, server });
      });
    });
  });
  const address = result.server.address();
  if (!address || typeof address === "string") {
    await closeServer(result.server);
    throw new Error("OAuth loopback callback did not receive a local port.");
  }
  return {
    awaitCode: async (): Promise<string> => {
      try {
        return await result.code;
      } finally {
        await closeServer(result.server);
      }
    },
    close: (): Promise<void> => closeServer(result.server),
    redirectUri: `http://127.0.0.1:${String(address.port)}/callback`,
  };
};
