import { JobCoordinator } from "../index";
import type { Env } from "../types";

type StorageValue = unknown;

function createMockState(): {
  state: DurableObjectState;
  storage: Map<string, StorageValue>;
} {
  const storage = new Map<string, StorageValue>();
  const state = {
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> =>
      callback(),
    storage: {
      get: async <T = StorageValue>(key: string): Promise<T | undefined> =>
        storage.get(key) as T | undefined,
      put: async (key: string, value: StorageValue): Promise<void> => {
        storage.set(key, value);
      },
      delete: async (key: string): Promise<boolean> => storage.delete(key),
    },
  } as unknown as DurableObjectState;

  return { state, storage };
}

export function createMockJobCoordinatorNamespace(env: Env): DurableObjectNamespace {
  const instances = new Map<string, JobCoordinator>();
  const namesById = new Map<string, string>();

  return {
    idFromName(name: string): DurableObjectId {
      const id = {
        toString: () => `mock-do:${name}`,
      } as DurableObjectId;
      namesById.set(id.toString(), name);
      return id;
    },
    get(id: DurableObjectId): DurableObjectStub {
      const name = namesById.get(id.toString()) || id.toString();
      if (!instances.has(name)) {
        const { state } = createMockState();
        instances.set(name, new JobCoordinator(state, env));
      }

      const instance = instances.get(name)!;
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
          const request = input instanceof Request
            ? input
            : new Request(
              typeof input === "string" || input instanceof URL
                ? input.toString()
                : String(input),
              init,
            );
          return instance.fetch(request);
        },
      } as DurableObjectStub;
    },
  } as DurableObjectNamespace;
}
