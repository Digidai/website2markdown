import createTlsEngine, { type TlsEngineModule } from "@ai-ecoverse/wasm-tls-engine";
import engineWasm from "@ai-ecoverse/wasm-tls-engine/slicc-tls-engine.wasm";
import { PROXY_ROOTS_PEM } from "./proxy-roots";

/** A TLS client session over a proxy's CONNECT tunnel. */
export interface ProxyTlsSession {
  /** Plaintext from the server; undefined once the server or the tunnel closes. */
  read(): Promise<Uint8Array | undefined>;
  write(data: Uint8Array): Promise<void>;
  /** Frees the session. Safe to call more than once. */
  close(): void;
}

// Room for one TLS record (16 KiB plus overhead) per call.
const SCRATCH_BYTES = 18 * 1024;

let engine: Promise<{ m: TlsEngineModule; ca: number }> | undefined;

function loadEngine() {
  engine ??= (async () => {
    // Workers compile no Wasm from bytes, and the Emscripten glue only instantiates bytes.
    // Hand it a placeholder buffer and, for that one call, instantiate the module Wrangler
    // compiled at deploy time instead. locateFile keeps the glue from resolving the file
    // against import.meta.url, which is no URL in a Worker bundle.
    const placeholder = new ArrayBuffer(8);
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = (async (source: unknown, imports?: WebAssembly.Imports) =>
      (source as Uint8Array)?.buffer === placeholder
        ? { module: engineWasm, instance: await instantiate(engineWasm, imports) }
        : instantiate(source as BufferSource, imports)) as typeof WebAssembly.instantiate;
    let m: TlsEngineModule;
    try {
      m = await createTlsEngine({ wasmBinary: placeholder, locateFile: (path) => path });
    } finally {
      WebAssembly.instantiate = instantiate;
    }

    const roots = pemToDer(PROXY_ROOTS_PEM);
    const ca = m._tls_ca_new();
    const ptr = copyIn(m, roots);
    const added = m._tls_ca_add_bundle(ca, ptr, roots.byteLength);
    m._free(ptr);
    if (added <= 0) throw new Error(`TLS trust store not loaded: ${describeError(m, added)}`);
    return { m, ca };
  })();
  // A failed load is retried by the next session instead of failing every later one.
  engine.catch(() => { engine = undefined; });
  return engine;
}

function pemToDer(pem: string): Uint8Array {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const ders = blocks.map((block) => {
    const b64 = block.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  });
  const out = new Uint8Array(ders.reduce((sum, der) => sum + der.byteLength, 0));
  let at = 0;
  for (const der of ders) {
    out.set(der, at);
    at += der.byteLength;
  }
  return out;
}

function copyIn(m: TlsEngineModule, bytes: Uint8Array): number {
  const ptr = m._malloc(Math.max(bytes.byteLength, 1));
  m.HEAPU8.set(bytes, ptr);
  return ptr;
}

function describeError(m: TlsEngineModule, code: number): string {
  const ptr = m._malloc(256);
  m._tls_strerror(code, ptr, 256);
  const end = m.HEAPU8.indexOf(0, ptr);
  const text = new TextDecoder().decode(m.HEAPU8.slice(ptr, end < 0 ? ptr + 256 : end));
  m._free(ptr);
  return `${text} (${code})`;
}

/**
 * Run a TLS 1.2 or 1.3 client handshake with `host` over a tunnel, verifying its certificate
 * chain against Mozilla's roots (Mbed TLS builds the chain from what the server sends, in any
 * order). A root dot on `host` is dropped for SNI and the name check ("example.com." is the
 * same host). `early` is tunnel data that arrived with the proxy's CONNECT answer.
 */
export async function startProxyTls(
  host: string,
  early: Uint8Array,
  networkRead: () => Promise<Uint8Array | undefined>,
  networkWrite: (data: Uint8Array) => Promise<void>,
): Promise<ProxyTlsSession> {
  const { m, ca } = await loadEngine();
  const name = new TextEncoder().encode(host);
  const namePtr = copyIn(m, name);
  const session = m._tls_client_new_name(ca, namePtr, name.byteLength, 0, 0, 0);
  m._free(namePtr);
  if (!session) throw new Error(`TLS session not created: ${describeError(m, m._tls_last_error())}`);
  const scratch = m._malloc(SCRATCH_BYTES);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    m._tls_session_free(session);
    m._free(scratch);
  };

  // Ciphertext received but not yet taken by the engine.
  let pending = early;
  const feed = () => {
    while (pending.byteLength > 0) {
      const len = Math.min(pending.byteLength, SCRATCH_BYTES);
      m.HEAPU8.set(pending.subarray(0, len), scratch);
      const taken = m._tls_feed(session, scratch, len);
      if (taken <= 0) return;
      pending = pending.subarray(taken);
    }
  };
  const flush = async () => {
    let size: number;
    // close() may run while a write is pending; the session must not be touched after it.
    while (!closed && (size = m._tls_out_size(session)) > 0) {
      const n = m._tls_out_take(session, scratch, Math.min(size, SCRATCH_BYTES));
      if (n <= 0) throw new Error(`TLS output not drained: ${describeError(m, n)}`);
      await networkWrite(m.HEAPU8.slice(scratch, scratch + n));
    }
  };
  /** Waits for more ciphertext; false when the tunnel closed. */
  const receive = async () => {
    if (pending.byteLength > 0) return true;
    const chunk = await networkRead();
    if (!chunk) return false;
    pending = chunk;
    return true;
  };

  try {
    while (true) {
      feed();
      const state = m._tls_handshake(session);
      await flush();
      if (state === 1) break;
      if (state < 0) {
        const flags = m._tls_verify_result(session);
        let detail = describeError(m, state);
        if (flags > 0) {
          const n = m._tls_verify_info(flags, scratch, SCRATCH_BYTES);
          if (n > 0) detail += `: ${new TextDecoder().decode(m.HEAPU8.slice(scratch, scratch + n)).trim()}`;
        }
        throw new Error(`TLS handshake with ${host} failed: ${detail}`);
      }
      if (!(await receive())) throw new Error(`TLS handshake with ${host} failed: the tunnel closed`);
    }
  } catch (error) {
    close();
    throw error;
  }

  return {
    async read() {
      while (!closed) {
        feed();
        const n = m._tls_read(session, scratch, SCRATCH_BYTES);
        if (n > 0) return m.HEAPU8.slice(scratch, scratch + n);
        if (n === -1) return undefined;
        if (n < 0) throw new Error(`TLS read failed: ${describeError(m, n)}`);
        await flush();
        // Many servers close the connection without a close_notify; treat that as the end.
        if (!(await receive())) return undefined;
      }
      return undefined;
    },
    async write(data) {
      let rest = data;
      while (rest.byteLength > 0) {
        if (closed) throw new Error("TLS session closed");
        const len = Math.min(rest.byteLength, SCRATCH_BYTES);
        m.HEAPU8.set(rest.subarray(0, len), scratch);
        const taken = m._tls_write(session, scratch, len);
        if (taken < 0) throw new Error(`TLS write failed: ${describeError(m, taken)}`);
        rest = rest.subarray(taken);
        await flush();
      }
    },
    close,
  };
}
