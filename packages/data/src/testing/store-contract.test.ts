import { runStoreContract } from "./store-contract";
import { MemoryStore } from "./memory-store";

runStoreContract("MemoryStore", async () => MemoryStore());
