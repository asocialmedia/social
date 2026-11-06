export type {
  BoundedStore as DiscoveryStore,
  CacheLease as DiscoveryLease,
} from "@asm/protocols/discovery";
export { RedisBoundedStore as RedisDiscoveryStore } from "@asm/protocols/discovery";
export { MemoryDiscoveryStore } from "./discovery-memory-store";

export const discoveryStoreCapacity = {
  maxBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
};

export const inventoryCursorCapacity = {
  maxBytes: 64 * 1024 * 1024,
  maxEntries: 8192,
};
