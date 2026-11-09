import { ArrowRightFromSquare, Envelope, Gear, House, Key, Plus, TrashBin } from "@gravity-ui/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Input,
  Label,
  Meter,
  Modal,
  Separator,
  Skeleton,
  Spinner,
  Table,
  TextField,
} from "@heroui/react";
import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Brand, CodeBlock, CopyButton, GithubButton, ThemeSwitcher } from "../components/ui";
import {
  initialPortalState,
  portalReducer,
  type ApiKey,
  type Banner,
  type Loadable,
  type Session,
  type Usage,
} from "../portal-state";

const THEME_LABELS = { light: "Light", dark: "Dark", system: "System", title: "Theme" };

type View = "dashboard" | "keys" | "settings";

const api = {
  get: (path: string) => fetch(path, { credentials: "same-origin" }),
  json: (path: string, method: string, body?: unknown) =>
    fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};

/** Parsed JSON body, or null when the body is not JSON. */
async function readJson<T>(resp: Response): Promise<T | null> {
  return (await resp.json().catch(() => null)) as T | null;
}

/**
 * Runs one submission at a time. Enter still submits a form whose button shows a spinner,
 * and React state is not updated between two submits in the same task, so a ref guards it.
 */
function useOneAtATime() {
  const busy = useRef(false);
  return useCallback(async (task: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await task();
    } finally {
      busy.current = false;
    }
  }, []);
}

function Notice({ banner }: { banner: Banner }) {
  if (!banner) return null;
  return (
    <Alert status={banner.status}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{banner.text}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** What to show for a value that loads on its own: a skeleton, a retry, or the value. */
function Loaded<T>({ value, what, onRetry, skeleton, children }: {
  value: Loadable<T>;
  what: string;
  onRetry: () => void;
  skeleton: ReactNode;
  children: (value: T) => ReactNode;
}) {
  if (value.status === "loading") return <>{skeleton}</>;
  if (value.status === "ready") return <>{children(value.value)}</>;
  return (
    <Card variant="secondary">
      <Card.Content className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-muted">Couldn't load {what}.</p>
        <Button size="sm" variant="secondary" onPress={onRetry}>Try again</Button>
      </Card.Content>
    </Card>
  );
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function PortalHeader({ host }: { host: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Brand host={host} />
        <Chip size="sm" variant="soft" color="accent" className="max-sm:hidden">Developer Portal</Chip>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeSwitcher labels={THEME_LABELS} />
          <GithubButton />
        </div>
      </div>
    </header>
  );
}

export function PortalPage({ host, hasSession, error }: { host: string; hasSession: boolean; error?: string }) {
  const [state, dispatch] = useReducer(portalReducer, undefined, () => initialPortalState(hasSession, error));
  const checking = state.phase === "checking";
  const signedIn = state.phase === "signedIn";

  useEffect(() => {
    if (error) history.replaceState(null, "", "/portal/");
  }, [error]);

  useEffect(() => {
    if (!checking) return;
    let cancelled = false;
    (async () => {
      const resp = await api.get("/api/me").catch(() => null);
      const session = resp?.ok ? await readJson<Session>(resp) : null;
      if (cancelled) return;
      // Only a 401 means "not signed in". Anything else is an outage, not a sign-out.
      if (resp?.status === 401) dispatch({ type: "meUnauthorized" });
      else if (session?.email) dispatch({ type: "meLoaded", session });
      else dispatch({ type: "meFailed" });
    })();
    return () => {
      cancelled = true;
    };
  }, [checking]);

  const loadUsage = useCallback(async () => {
    dispatch({ type: "usageLoading" });
    const resp = await api.get("/api/usage").catch(() => null);
    if (resp?.status === 401) return dispatch({ type: "sessionExpired" });
    const usage = resp?.ok ? await readJson<Usage>(resp) : null;
    dispatch(typeof usage?.quota === "number" ? { type: "usageLoaded", usage } : { type: "usageFailed" });
  }, []);

  const loadKeys = useCallback(async () => {
    dispatch({ type: "keysLoading" });
    const resp = await api.get("/api/keys").catch(() => null);
    if (resp?.status === 401) return dispatch({ type: "sessionExpired" });
    const data = resp?.ok ? await readJson<{ keys?: ApiKey[] }>(resp) : null;
    dispatch(Array.isArray(data?.keys) ? { type: "keysLoaded", keys: data.keys } : { type: "keysFailed" });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void loadUsage();
    void loadKeys();
  }, [signedIn, loadUsage, loadKeys]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <PortalHeader host={host} />
      {state.phase === "checking" ? (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-20">
          <h1 className="sr-only">Developer Portal</h1>
          <Skeleton className="h-8 w-2/3 rounded-lg" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </main>
      ) : state.phase === "unavailable" ? (
        <main className="grid flex-1 place-items-center px-4 py-16">
          <Card className="w-full max-w-md">
            <Card.Header className="gap-2">
              <h1 className="card__title text-2xl" data-slot="card-title">Developer Portal</h1>
              <Card.Description>We couldn't check your session. Your API keys are not affected.</Card.Description>
            </Card.Header>
            <Card.Footer>
              <Button onPress={() => dispatch({ type: "retry" })}>Try again</Button>
            </Card.Footer>
          </Card>
        </main>
      ) : state.phase === "signedOut" ? (
        <SignIn banner={state.banner} />
      ) : (
        <Dashboard
          session={state.session}
          usage={state.usage}
          keys={state.keys}
          reloadUsage={loadUsage}
          reloadKeys={loadKeys}
          onUnauthorized={() => dispatch({ type: "sessionExpired" })}
          onSignOut={() => dispatch({ type: "signedOut" })}
        />
      )}
    </div>
  );
}

type SendState = { status: "idle" } | { status: "sending" } | { status: "sent" } | { status: "failed"; text: string };

function SignIn({ banner: initial }: { banner: Banner }) {
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const oneAtATime = useOneAtATime();
  const pending = send.status === "sending";
  const banner: Banner =
    send.status === "sent" ? { status: "success", text: "Check your email for the sign-in link. It expires in 15 minutes." }
    : send.status === "failed" ? { status: "danger", text: send.text }
    : send.status === "idle" ? initial
    : null;
  // The form is server-rendered, so it shows before this script runs. Until then the button stays
  // disabled, which also stops Enter from submitting the form natively with the email in the URL.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Text typed before hydration is only in the DOM. Seed the field with it, or React's first
  // update after hydration writes the empty value back over it.
  const [typedEarly] = useState(() =>
    typeof document === "undefined" ? "" : (document.querySelector<HTMLInputElement>('input[name="email"]')?.value ?? ""),
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read the field itself: text typed before hydration is in the input but not in React state.
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    await oneAtATime(async () => {
      setSend({ status: "sending" });
      try {
        const source = new URL(location.href).searchParams.get("ref") || undefined;
        const resp = await api.json("/api/auth/magic-link", "POST", { email, source });
        const data = await readJson<{ error?: string }>(resp);
        setSend(resp.ok ? { status: "sent" } : { status: "failed", text: data?.error || "Failed to send link" });
      } catch {
        setSend({ status: "failed", text: "Network error. Try again." });
      }
    });
  };

  return (
    <main className="grid flex-1 place-items-center px-4 py-16">
      <Card className="w-full max-w-md">
        <Card.Header className="gap-2">
          <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground">
            <Key className="size-5" />
          </span>
          {/* Card.Title is an <h3>; an <h1> inside it gets split apart by the HTML parser and breaks hydration. */}
          <h1 className="card__title text-2xl" data-slot="card-title">Developer Portal</h1>
          <Card.Description>Sign in to manage API keys and usage. No password: we email you a link.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <Notice banner={banner} />
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextField isRequired type="email" name="email" autoComplete="email" defaultValue={typedEarly}>
              <Label>Email</Label>
              <Input placeholder="you@example.com" autoFocus />
            </TextField>
            <Button type="submit" fullWidth isPending={pending} isDisabled={!ready}>
              {pending ? <Spinner color="current" size="sm" /> : <Envelope className="size-4" />}
              {pending ? "Sending..." : "Send login link"}
            </Button>
          </form>
        </Card.Content>
        <Card.Footer>
          <p className="text-sm leading-6 text-muted">
            Already have an API key? Use it directly in the <code className="font-mono text-foreground">Authorization: Bearer</code> header
            without signing in.
          </p>
        </Card.Footer>
      </Card>
    </main>
  );
}

function Dashboard({
  session,
  usage,
  keys,
  reloadUsage,
  reloadKeys,
  onUnauthorized,
  onSignOut,
}: {
  session: Session;
  usage: Loadable<Usage>;
  keys: Loadable<ApiKey[]>;
  reloadUsage: () => Promise<void>;
  reloadKeys: () => Promise<void>;
  onUnauthorized: () => void;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<View>("dashboard");
  const nav: { id: View; label: string; icon: typeof House }[] = [
    { id: "dashboard", label: "Dashboard", icon: House },
    { id: "keys", label: "API Keys", icon: Key },
    { id: "settings", label: "Settings", icon: Gear },
  ];
  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-10 sm:px-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Portal" className="flex gap-1 md:flex-col">
        {nav.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={view === id ? "secondary" : "ghost"}
            className="justify-start"
            onPress={() => setView(id)}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </nav>
      <main className="flex min-w-0 flex-col gap-8">
        {view === "dashboard" ? (
          <Overview session={session} usage={usage} keys={keys} reloadUsage={reloadUsage} reloadKeys={reloadKeys} goToKeys={() => setView("keys")} />
        ) : view === "keys" ? (
          <KeysView keys={keys} reloadKeys={reloadKeys} onUnauthorized={onUnauthorized} />
        ) : (
          <SettingsView session={session} onSignOut={onSignOut} />
        )}
      </main>
    </div>
  );
}

function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-muted">{description}</p> : null}
    </div>
  );
}

function Overview({ session, usage, keys, reloadUsage, reloadKeys, goToKeys }: {
  session: Session;
  usage: Loadable<Usage>;
  keys: Loadable<ApiKey[]>;
  reloadUsage: () => Promise<void>;
  reloadKeys: () => Promise<void>;
  goToKeys: () => void;
}) {
  return (
    <>
      <PageTitle title="Dashboard" description={`Welcome back, ${session.email}.`} />
      <Loaded
        value={usage}
        what="your usage"
        onRetry={() => void reloadUsage()}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        }
      >
        {(u) => <UsageCards usage={u} />}
      </Loaded>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent keys</h2>
          <Button size="sm" variant="secondary" onPress={goToKeys}>Manage keys</Button>
        </div>
        <Loaded value={keys} what="your keys" onRetry={() => void reloadKeys()} skeleton={<Skeleton className="h-24 rounded-2xl" />}>
          {(list) =>
            list.length ? (
              <KeyTable keys={list.slice(0, 3)} />
            ) : (
              <Card variant="secondary">
                <Card.Content className="flex flex-col items-center gap-3 py-8 text-center">
                  <p className="text-muted">No API keys yet.</p>
                  <Button onPress={goToKeys}>
                    <Plus className="size-4" />
                    Create your first key
                  </Button>
                </Card.Content>
              </Card>
            )}
        </Loaded>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Quick start</h2>
        <CodeBlock title="curl" code={`curl -H "Authorization: Bearer mk_..." \\\n  "https://mdget.dev/https://example.com?raw=true"`} />
      </section>
    </>
  );
}

function UsageCards({ usage: u }: { usage: Usage }) {
  const pct = u.quota ? Math.min(100, Math.round((u.used / u.quota) * 100)) : 0;
  const color = pct >= 90 ? "danger" : pct >= 70 ? "warning" : "accent";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <Card.Header>
          <Card.Description>Current tier</Card.Description>
          <Chip size="lg" variant="soft" color={u.tier === "pro" ? "success" : "accent"} className="mt-1 self-start capitalize">
            {u.tier}
          </Chip>
        </Card.Header>
        <Card.Footer>
          <p className="text-sm text-muted">Quota: {u.quota.toLocaleString()} credits/mo</p>
        </Card.Footer>
      </Card>
      <Card>
        <Card.Content>
          <Meter value={u.used} maxValue={Math.max(u.quota, 1)} color={color} aria-label="Credits used this month">
            <Label>Usage this month</Label>
            <Meter.Output>{`${u.used.toLocaleString()} / ${u.quota.toLocaleString()}`}</Meter.Output>
            <Meter.Track>
              <Meter.Fill />
            </Meter.Track>
          </Meter>
        </Card.Content>
        <Card.Footer>
          <p className="text-sm text-muted">{u.remaining.toLocaleString()} credits remaining</p>
        </Card.Footer>
      </Card>
    </div>
  );
}

function KeyTable({ keys, onRevoke }: { keys: ApiKey[]; onRevoke?: (id: string) => Promise<boolean> }) {
  // One key at a time waits for a second press; several revokes may be in flight.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ReadonlySet<string>>(() => new Set());
  const press = async (id: string) => {
    if (!onRevoke || revoking.has(id)) return;
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    setRevoking((ids) => new Set(ids).add(id));
    await onRevoke(id);
    setRevoking((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  };
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="API keys">
          <Table.Header>
            <Table.Column isRowHeader>Name</Table.Column>
            <Table.Column>Prefix</Table.Column>
            <Table.Column>Created</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column> </Table.Column>
          </Table.Header>
          <Table.Body>
            {keys.map((k) => (
              <Table.Row key={k.id} id={k.id}>
                <Table.Cell>{k.name || "—"}</Table.Cell>
                <Table.Cell><code className="font-mono text-[13px]">{k.prefix}</code></Table.Cell>
                <Table.Cell>{formatDate(k.created_at)}</Table.Cell>
                <Table.Cell>
                  <Chip size="sm" variant="soft" color={k.active ? "success" : "default"}>{k.active ? "Active" : "Revoked"}</Chip>
                </Table.Cell>
                <Table.Cell>
                  {k.active && onRevoke ? (
                    <Button
                      size="sm"
                      variant={confirming === k.id ? "danger" : "danger-soft"}
                      isPending={revoking.has(k.id)}
                      onPress={() => void press(k.id)}
                    >
                      <TrashBin className="size-3.5" />
                      {confirming === k.id ? "Confirm revoke" : "Revoke"}
                    </Button>
                  ) : null}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** idle → creating → created (the full key, shown once) → idle. */
type CreateState = { status: "idle" } | { status: "creating" } | { status: "created"; key: string; saved: boolean };

function KeysView({ keys, reloadKeys, onUnauthorized }: {
  keys: Loadable<ApiKey[]>;
  reloadKeys: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState("");
  const [create, setCreate] = useState<CreateState>({ status: "idle" });
  const [banner, setBanner] = useState<Banner>(null);
  const oneAtATime = useOneAtATime();
  const creating = create.status === "creating";

  // A second request while one is in flight would make a second key whose secret is never shown.
  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return oneAtATime(createKey);
  };

  const createKey = async () => {
    setCreate({ status: "creating" });
    setBanner(null);
    try {
      const resp = await api.json("/api/keys", "POST", { name: name.trim() });
      if (resp.status === 401) return onUnauthorized();
      const data = await readJson<{ key?: string; message?: string; error?: string }>(resp);
      if (!resp.ok || !data?.key) {
        setCreate({ status: "idle" });
        setBanner({ status: "danger", text: data?.message || data?.error || "Failed to create key" });
        return;
      }
      setCreate({ status: "created", key: data.key, saved: false });
      setName("");
      void reloadKeys();
    } catch {
      setCreate({ status: "idle" });
      setBanner({ status: "danger", text: "Network error. Try again." });
    }
  };

  const revoke = async (id: string) => {
    setBanner(null);
    const resp = await api.json(`/api/keys/${encodeURIComponent(id)}`, "DELETE").catch(() => null);
    if (resp?.status === 401) {
      onUnauthorized();
      return false;
    }
    if (resp?.ok) await reloadKeys();
    else setBanner({ status: "danger", text: "Could not revoke the key." });
    return Boolean(resp?.ok);
  };

  return (
    <>
      <PageTitle title="API Keys" description="Up to 10 active keys per account. The full key is shown once, when you create it." />
      <Notice banner={banner} />
      <Card>
        <Card.Content>
          <form onSubmit={onCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField className="flex-1" name="key-name" value={name} onChange={setName} maxLength={80} isDisabled={creating}>
              <Label>New key name</Label>
              <Input placeholder="prod" autoComplete="off" />
            </TextField>
            <Button type="submit" isPending={creating}>
              <Plus className="size-4" />
              Create key
            </Button>
          </form>
        </Card.Content>
      </Card>
      <Loaded value={keys} what="your keys" onRetry={() => void reloadKeys()} skeleton={<Skeleton className="h-24 rounded-2xl" />}>
        {(list) =>
          list.length ? (
            <KeyTable keys={list} onRevoke={revoke} />
          ) : (
            <p className="text-muted">No keys yet. Name one above and create it.</p>
          )}
      </Loaded>

      <Modal.Backdrop isOpen={create.status === "created"} isDismissable={false} isKeyboardDismissDisabled>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Key className="size-5" />
              </Modal.Icon>
              <Modal.Heading>Save your API key</Modal.Heading>
            </Modal.Header>
            {create.status === "created" ? (
              <Modal.Body className="flex flex-col gap-4">
                <p className="text-sm text-muted">This is the only time you'll see the full key. Store it somewhere safe.</p>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-secondary p-3">
                  <code className="flex-1 font-mono text-sm break-all">{create.key}</code>
                  <CopyButton text={create.key} variant="secondary" />
                </div>
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>If you lose it, revoke it and create another.</Alert.Description>
                  </Alert.Content>
                </Alert>
                <Checkbox isSelected={create.saved} onChange={(saved) => setCreate({ ...create, saved })}>
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    I have saved this key securely
                  </Checkbox.Content>
                </Checkbox>
              </Modal.Body>
            ) : null}
            <Modal.Footer>
              <Button isDisabled={create.status !== "created" || !create.saved} onPress={() => setCreate({ status: "idle" })}>Close</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

function SettingsView({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [signOut, setSignOut] = useState<"idle" | "pending" | "failed">("idle");
  return (
    <>
      <PageTitle title="Settings" />
      <Card>
        <Card.Header>
          <Card.Title>Account</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted">Email</span>
            <span className="font-medium">{session.email}</span>
          </div>
          <Separator />
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted">Sign-in method</span>
            <span className="font-medium">Magic link (email)</span>
          </div>
        </Card.Content>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>Sign out</Card.Title>
          <Card.Description>Ends this browser session. Your API keys keep working.</Card.Description>
        </Card.Header>
        {signOut === "failed" ? (
          <Card.Content>
            <Notice banner={{ status: "danger", text: "Could not sign out. Check your connection and try again." }} />
          </Card.Content>
        ) : null}
        <Card.Footer>
          <Button
            variant="danger-soft"
            isPending={signOut === "pending"}
            onPress={async () => {
              setSignOut("pending");
              const resp = await api.json("/api/auth/logout", "POST").catch(() => null);
              // Only a response from the server clears the cookie; a 401 means it was already gone.
              if (resp?.ok || resp?.status === 401) onSignOut();
              else setSignOut("failed");
            }}
          >
            <ArrowRightFromSquare className="size-4" />
            Sign out
          </Button>
        </Card.Footer>
      </Card>
    </>
  );
}
