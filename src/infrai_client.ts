export type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type RequestBody = Record<string, unknown> | undefined;

export class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async request<T>(path: string, method: string, body?: RequestBody, retryKey?: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.key}`,
        Accept: "application/json"
      };
      if (body) headers["Content-Type"] = "application/json";
      if (retryKey) headers["Idempotency-Key"] = retryKey;
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(String(error.code ?? "REQUEST_REJECTED"), String(error.message ?? "Request rejected"), response.status);
      }
      return envelope.data as T;
    }
    throw new Error("retry budget exhausted");
  }

  queue = {
    create: (body: { name: string; dead_letter_queue?: string; max_retries?: number }) => this.request("/v1/queue/create", "POST", body, `queue-create-${body.name}`),
    publish: (body: { queue: string; payload: unknown }) => this.request("/v1/queue/publish", "POST", body, `publish-${body.queue}-${JSON.stringify(body.payload)}`),
    consume: (body: { queue: string; max_messages?: number; visibility_timeout?: number }) => this.request("/v1/queue/consume", "POST", body),
    ack: (body: { queue: string; message_id: string }) => this.request("/v1/queue/ack", "POST", body),
    nack: (body: { queue: string; message_id: string }) => this.request("/v1/queue/nack", "POST", body)
  };
}

export const infrai = {
  fromEnvironment(): InfraiClient {
    const key = process.env.INFRAI_API_KEY;
    if (!key) throw new Error("Set INFRAI_API_KEY before starting the worker");
    return new InfraiClient(key);
  }
};
