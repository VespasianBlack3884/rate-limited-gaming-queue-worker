import assert from "node:assert/strict";
import { shouldModerate } from "./queue_worker.ts";

const newAsset = { assetId: "a1", playerId: "p1", event: "asset.created" as const, moderation: "required" as const };
const existingAsset = { ...newAsset, event: "asset.updated" as const };
assert.equal(shouldModerate(newAsset), true);
assert.equal(shouldModerate(existingAsset), false);
console.log("asset.created + required -> moderation acknowledgement; asset.updated -> no acknowledgement");
