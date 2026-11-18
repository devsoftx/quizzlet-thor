// Test helper: a real Redis for the tests of RedisStore and the maintenance
// scripts. Production talks to Upstash over its REST API, so this starts a
// throwaway `redis-server` (or uses the disposable one named in
// QUIZZLET_TEST_REDIS, "host:port") and puts a small REST bridge in front of it
// that speaks the part of the Upstash protocol the client uses.
//
// The Redis it points at is emptied between tests: never aim it at real data.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { Redis } from "@upstash/redis";

type Reply = string | number | null | RedisError | Reply[];

class RedisError {
  constructor(readonly message: string) {}
}

/** Reads one reply of the Redis protocol from `buffer` at `at`; null if it isn't all there yet. */
function parseReply(buffer: Buffer, at: number): { value: Reply; next: number } | null {
  const lineEnd = buffer.indexOf("\r\n", at);
  if (lineEnd < 0) return null;
  const line = buffer.toString("utf8", at + 1, lineEnd);
  const next = lineEnd + 2;
  switch (String.fromCharCode(buffer[at])) {
    case "+":
      return { value: line, next };
    case "-":
      return { value: new RedisError(line), next };
    case ":":
      return { value: Number(line), next };
    case "$": {
      const length = Number(line);
      if (length < 0) return { value: null, next };
      if (buffer.length < next + length + 2) return null;
      return { value: buffer.toString("utf8", next, next + length), next: next + length + 2 };
    }
    case "*": {
      const count = Number(line);
      if (count < 0) return { value: null, next };
      const items: Reply[] = [];
      let cursor = next;
      for (let i = 0; i < count; i++) {
        const item = parseReply(buffer, cursor);
        if (!item) return null;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`Unexpected Redis reply: ${line}`);
  }
}

/** One connection to Redis; commands are answered in the order they were sent. */
class Connection {
  private buffer: Buffer = Buffer.alloc(0);
  private waiting: Array<(reply: Reply) => void> = [];

  private constructor(private socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (let parsed = parseReply(this.buffer, 0); parsed; parsed = parseReply(this.buffer, 0)) {
        this.buffer = this.buffer.subarray(parsed.next);
        this.waiting.shift()?.(parsed.value);
      }
    });
  }

  static open(host: string, port: number): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, host);
      socket.once("error", reject);
      socket.once("connect", () => resolve(new Connection(socket)));
    });
  }

  send(command: unknown[]): Promise<Reply> {
    const parts = command.map((arg) => {
      const bytes = Buffer.from(typeof arg === "string" ? arg : JSON.stringify(arg));
      return Buffer.concat([Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n")]);
    });
    this.socket.write(Buffer.concat([Buffer.from(`*${command.length}\r\n`), ...parts]));
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  close() {
    this.socket.destroy();
  }
}

/** Upstash sends strings as base64 when the client asks for it (its default), except a plain "OK". */
function encoded(reply: Reply): Reply {
  if (typeof reply === "string") return reply === "OK" ? reply : Buffer.from(reply, "utf8").toString("base64");
  return Array.isArray(reply) ? reply.map(encoded) : reply;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The REST bridge: single commands on "/", batches on "/pipeline" and "/multi-exec". */
function startBridge(host: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      // Its own connection per request, so requests run side by side like real clients.
      const redis = await Connection.open(host, port);
      try {
        const body = await readBody(req);
        const base64 = req.headers["upstash-encoding"] === "base64";
        const answer = (reply: Reply) =>
          reply instanceof RedisError ? { error: reply.message } : { result: base64 ? encoded(reply) : reply };
        let status = 200;
        let payload: unknown;
        if (req.url === "/pipeline") {
          const replies: Reply[] = [];
          for (const command of body as unknown[][]) replies.push(await redis.send(command));
          payload = replies.map(answer);
        } else if (req.url === "/multi-exec") {
          await redis.send(["MULTI"]);
          for (const command of body as unknown[][]) await redis.send(command);
          const replies = await redis.send(["EXEC"]);
          payload = Array.isArray(replies) ? replies.map(answer) : answer(replies);
        } else {
          const reply = await redis.send(body as unknown[]);
          if (reply instanceof RedisError) status = 400;
          payload = answer(reply);
        }
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(err) }));
      } finally {
        redis.close();
      }
    })();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(host: string, port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const redis = await Connection.open(host, port);
      const pong = await redis.send(["PING"]);
      redis.close();
      if (pong === "PONG") return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The test Redis did not become ready.");
}

const external = process.env.QUIZZLET_TEST_REDIS;

/** True when a Redis for tests can be had: a disposable one was named, or `redis-server` is installed. */
export const redisAvailable = Boolean(external) || spawnSync("redis-server", ["--version"]).status === 0;

export interface TestRedis {
  /** An Upstash client like production's, pointed at the test Redis. */
  redis: Redis;
  /** The same connection details as the environment variables the app and the scripts read. */
  env: { UPSTASH_REDIS_REST_URL: string; UPSTASH_REDIS_REST_TOKEN: string };
  /** Empties the test Redis. */
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export async function startTestRedis(): Promise<TestRedis> {
  let host = "127.0.0.1";
  let port: number;
  let child: ChildProcess | null = null;
  if (external) {
    const [h, p] = external.split(":");
    host = h;
    port = Number(p);
  } else {
    port = await freePort();
    child = spawn("redis-server", ["--port", String(port), "--bind", host, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  }
  await waitUntilReady(host, port);
  const bridge = await startBridge(host, port);
  const url = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  const token = "local-test-only";
  const redis = new Redis({ url, token });
  return {
    redis,
    env: { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token },
    async flush() {
      await redis.flushall();
    },
    async stop() {
      await new Promise((resolve) => bridge.close(resolve));
      child?.kill();
    },
  };
}
