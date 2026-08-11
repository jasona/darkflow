import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createRequire } from "node:module";
import { createServer as createTcpServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createServer as createTlsServer } from "node:tls";

export type TransportName = "ws" | "wss" | "telnet" | "telnets";

export interface TransportEndpoint {
  readonly commands: string[];
  readonly port: number;
  readonly prompt: string;
  readonly protocol: TransportName;
  readonly reply: string;
  activeSocketCount(): number;
  sendText(text: string): void;
}

interface FixtureWebSocket {
  on(
    event: "message",
    listener: (data: ArrayBuffer | Buffer | Buffer[], isBinary: boolean) => void,
  ): void;
  send(data: Buffer | string, options?: { binary?: boolean }): void;
  terminate(): void;
}

interface FixtureWebSocketServer {
  readonly clients: Set<FixtureWebSocket>;
  close(callback: (error?: Error) => void): void;
  on(event: "connection", listener: (socket: FixtureWebSocket) => void): void;
}

interface FixtureWebSocketServerConstructor {
  new (options: { server: Server }): FixtureWebSocketServer;
}

interface OwnedServer {
  close(): Promise<void>;
}

const require = createRequire(path.join(process.cwd(), "package.json"));
const { WebSocketServer } = require("ws") as {
  WebSocketServer: FixtureWebSocketServerConstructor;
};

export const localhostCertificatePath = path.join(process.cwd(), "e2e/fixtures/localhost-cert.pem");
export const localhostKeyPath = path.join(process.cwd(), "e2e/fixtures/localhost-key.pem");

const certificate = readFileSync(localhostCertificatePath);
const privateKey = readFileSync(localhostKeyPath);
const host = "127.0.0.1";
const IAC = 255;
const WILL = 251;
const SB = 250;
const SE = 240;
const TELOPT_GMCP = 201;
const gmcpPayload = Buffer.from('Fixture.Ping {"ok":true}', "utf8");
const gmcpFrame = Buffer.concat([
  Buffer.from([IAC, SB, TELOPT_GMCP]),
  gmcpPayload,
  Buffer.from([IAC, SE]),
]);

function asBuffer(data: ArrayBuffer | Buffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, host, () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Transport fixture did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function trackSockets(server: Server): Set<Socket> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return sockets;
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeWebSocketServer(server: FixtureWebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startWebSocketFixture(
  protocol: "ws" | "wss",
): Promise<{ endpoint: TransportEndpoint; owner: OwnedServer }> {
  const prompt = `${protocol} fixture ready`;
  const reply = `${protocol} fixture reply`;
  const commands: string[] = [];
  const server =
    protocol === "wss"
      ? createHttpsServer({ cert: certificate, key: privateKey })
      : createHttpServer();
  const sockets = trackSockets(server);
  const webSocketServer = new WebSocketServer({ server });

  webSocketServer.on("connection", (socket) => {
    socket.send(prompt);
    socket.send(gmcpPayload, { binary: true });
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const command = asBuffer(data).toString("utf8");
      commands.push(command);
      if (command === "look") socket.send(reply);
    });
  });

  const port = await listen(server);
  return {
    endpoint: {
      activeSocketCount: () => sockets.size,
      commands,
      port,
      prompt,
      protocol,
      reply,
      sendText(text) {
        for (const client of webSocketServer.clients) client.send(text);
      },
    },
    owner: {
      async close() {
        await closeWebSocketServer(webSocketServer);
        await closeServer(server, sockets);
      },
    },
  };
}

class TelnetTextCollector {
  #command = Buffer.alloc(0);
  #state: "data" | "iac" | "option" | "subnegotiation" | "subnegotiation-iac" = "data";

  push(chunk: Buffer): string[] {
    const commands: string[] = [];

    for (const byte of chunk) {
      if (this.#state === "data") {
        if (byte === IAC) {
          this.#state = "iac";
        } else {
          this.#command = Buffer.concat([this.#command, Buffer.from([byte])]);
          const delimiter = this.#command.indexOf("\r\n");
          if (delimiter !== -1) {
            commands.push(this.#command.subarray(0, delimiter + 2).toString("utf8"));
            this.#command = this.#command.subarray(delimiter + 2);
          }
        }
        continue;
      }

      if (this.#state === "iac") {
        if (byte === IAC) {
          this.#command = Buffer.concat([this.#command, Buffer.from([byte])]);
          this.#state = "data";
        } else if (byte === SB) {
          this.#state = "subnegotiation";
        } else if (byte === 251 || byte === 252 || byte === 253 || byte === 254) {
          this.#state = "option";
        } else {
          this.#state = "data";
        }
        continue;
      }

      if (this.#state === "option") {
        this.#state = "data";
        continue;
      }

      if (this.#state === "subnegotiation") {
        if (byte === IAC) this.#state = "subnegotiation-iac";
        continue;
      }

      if (byte === SE) this.#state = "data";
      else if (byte !== IAC) this.#state = "subnegotiation";
    }

    return commands;
  }
}

async function startTelnetFixture(
  protocol: "telnet" | "telnets",
): Promise<{ endpoint: TransportEndpoint; owner: OwnedServer }> {
  const prompt = `${protocol} fixture ready`;
  const reply = `${protocol} fixture reply`;
  const commands: string[] = [];
  const onConnection = (socket: Socket) => {
    const collector = new TelnetTextCollector();
    socket.write(
      Buffer.concat([
        Buffer.from([IAC, WILL, TELOPT_GMCP]),
        Buffer.from(prompt, "utf8"),
        gmcpFrame,
      ]),
    );
    socket.on("data", (chunk) => {
      for (const command of collector.push(chunk)) {
        commands.push(command);
        if (command === "look\r\n") socket.write(reply);
      }
    });
  };
  const server =
    protocol === "telnets"
      ? createTlsServer({ cert: certificate, key: privateKey }, onConnection)
      : createTcpServer(onConnection);
  const sockets = trackSockets(server);
  const port = await listen(server);

  return {
    endpoint: {
      activeSocketCount: () => sockets.size,
      commands,
      port,
      prompt,
      protocol,
      reply,
      sendText(text) {
        for (const socket of sockets) socket.write(text);
      },
    },
    owner: {
      close: () => closeServer(server, sockets),
    },
  };
}

export class TransportFixtureOwner {
  readonly endpoints: Readonly<Record<TransportName, TransportEndpoint>>;
  readonly #owners: OwnedServer[];

  private constructor(endpoints: Record<TransportName, TransportEndpoint>, owners: OwnedServer[]) {
    this.endpoints = endpoints;
    this.#owners = owners;
  }

  static async start(): Promise<TransportFixtureOwner> {
    const started: Array<{ endpoint: TransportEndpoint; owner: OwnedServer }> = [];
    try {
      for (const protocol of ["ws", "wss"] as const) {
        started.push(await startWebSocketFixture(protocol));
      }
      for (const protocol of ["telnet", "telnets"] as const) {
        started.push(await startTelnetFixture(protocol));
      }
    } catch (error) {
      await Promise.allSettled(started.map(({ owner }) => owner.close()));
      throw error;
    }

    const endpoints = Object.fromEntries(
      started.map(({ endpoint }) => [endpoint.protocol, endpoint]),
    ) as Record<TransportName, TransportEndpoint>;
    return new TransportFixtureOwner(
      endpoints,
      started.map(({ owner }) => owner),
    );
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      this.#owners.toReversed().map((owner) => owner.close()),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Failed to close transport fixtures",
      );
    }
  }
}
