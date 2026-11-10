import { infrai, InfraiClient } from "./infrai_client.ts";
import { z } from "zod";

export type GameJob = {
  assetId: string;
  playerId: string;
  event: "asset.created" | "asset.updated";
  moderation: "required" | "clear";
};

export const gameJobSchema = z.object({
  assetId: z.string().min(1),
  playerId: z.string().min(1),
  event: z.enum(["asset.created", "asset.updated"]),
  moderation: z.enum(["required", "clear"])
});

export function parseGameJob(input: unknown): GameJob {
  return gameJobSchema.parse(input);
}

export function shouldModerate(job: GameJob): boolean {
  return job.moderation === "required" && job.event === "asset.created";
}

export async function prepareQueues(client: InfraiClient, source: string, dlq: string): Promise<void> {
  await client.queue.create({ name: dlq });
  await client.queue.create({ name: source, dead_letter_queue: dlq, max_retries: 3 });
}

export async function publishAsset(client: InfraiClient, queue: string, job: GameJob): Promise<void> {
  await client.queue.publish({ queue, payload: job });
}

export async function consumeOnce(client: InfraiClient, queue: string): Promise<string[]> {
  const result = await client.queue.consume({ queue, max_messages: 5, visibility_timeout: 30 }) as { messages?: Array<{ message_id: string; payload: GameJob }> };
  const acknowledged: string[] = [];
  for (const message of result.messages ?? []) {
    if (shouldModerate(message.payload)) {
      acknowledged.push(message.message_id);
    }
    await client.queue.ack({ queue, message_id: message.message_id });
  }
  return acknowledged;
}

if (import.meta.main) {
  const client = infrai.fromEnvironment();
  const queue = process.env.GAME_QUEUE ?? "game-assets";
  const dlq = process.env.GAME_DLQ ?? "game-assets-dlq";
  await prepareQueues(client, queue, dlq);
  await publishAsset(client, queue, { assetId: "sword-42", playerId: "player-7", event: "asset.created", moderation: "required" });
  console.log(await consumeOnce(client, queue));
}
