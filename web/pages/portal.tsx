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
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Brand, CodeBlock, CopyButton, GithubButton, ThemeSwitcher } from "../components/ui";

const THEME_LABELS = { light: "Light", dark: "Dark", system: "System", title: "Theme" };

interface Session { email: string; tier: string; account_id?: string }
interface Usage { tier: string; quota: number; used: number; remaining: number }
interface ApiKey { id: string; name: string | null; prefix: string; created_at: string; active: boolean }
type View = "dashboard" | "keys" | "settings";
type Banner = { status: "success" | "danger"; text: string } | null;

const SIGN_IN_ERRORS: Record<string, string> = {
  invalid_token: "This sign-in link is invalid.",
  link_expired: "This sign-in link has expired. Please request a new one.",
  link_already_used: "This sign-in link has already been used.",
  service_unavailable: "Sign-in service is temporarily unavailable.",
  internal_error: "Something went wrong. Please try again.",
};

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

export function PortalPage({ host }: { host: string }) {
  const [status, setStatus] = useState<"loading" | "signed-out" | "signed-in">("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [banner, setBanner] = useState<Banner>(null);

  const loadKeys = useCallback(async () => {
    const resp = await api.get("/api/keys").catch(() => null);
    if (resp?.ok) setKeys(((await resp.json()) as { keys?: ApiKey[] }).keys || []);
  }, []);

  useEffect(() => {
    const url = new URL(location.href);
    const error = url.searchParams.get("error");
    (async () => {
      const resp = await api.get("/api/me").catch(() => null);
      if (resp?.ok) {
        setSession((await resp.json()) as Session);
        const usageResp = await api.get("/api/usage").catch(() => null);
        if (usageResp?.ok) setUsage((await usageResp.json()) as Usage);
        await loadKeys();
        setStatus("signed-in");
      } else {
        if (error) setBanner({ status: "danger", text: SIGN_IN_ERRORS[error] || "Sign-in failed." });
        setStatus("signed-out");
      }
      if (error) history.replaceState(null, "", "/portal/");
    })();
  }, [loadKeys]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <PortalHeader host={host} />
      {status === "loading" ? (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-20">
          <h1 className="sr-only">Developer Portal</h1>
          <Skeleton className="h-8 w-2/3 rounded-lg" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </main>
      ) : status === "signed-out" ? (
        <SignIn banner={banner} />
      ) : (
        <Dashboard
          session={session!}
          usage={usage}
          keys={keys}
          reloadKeys={loadKeys}
          onSignOut={() => {
            setSession(null);
            setStatus("signed-out");
          }}
        />
      )}
    </div>
  );
}

function SignIn({ banner: initial }: { banner: Banner }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<Banner>(initial);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    setPending(true);
    try {
      const resp = await api.json("/api/auth/magic-link", "POST", { email: email.trim() });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      setBanner(
        resp.ok
          ? { status: "success", text: "Check your email for the sign-in link. It expires in 15 minutes." }
          : { status: "danger", text: data.error || "Failed to send link" },
      );
    } catch {
      setBanner({ status: "danger", text: "Network error. Try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid flex-1 place-items-center px-4 py-16">
      <Card className="w-full max-w-md">
        <Card.Header className="gap-2">
          <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground">
            <Key className="size-5" />
          </span>
          <Card.Title className="text-2xl">
            <h1>Developer Portal</h1>
          </Card.Title>
          <Card.Description>Sign in to manage API keys and usage. No password: we email you a link.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {banner ? (
            <Alert status={banner.status}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{banner.text}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextField isRequired type="email" name="email" value={email} onChange={setEmail} autoComplete="email">
              <Label>Email</Label>
              <Input placeholder="you@example.com" autoFocus />
            </TextField>
            <Button type="submit" fullWidth isPending={pending}>
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
  reloadKeys,
  onSignOut,
}: {
  session: Session;
  usage: Usage | null;
  keys: ApiKey[];
  reloadKeys: () => Promise<void>;
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
          <Overview session={session} usage={usage} keys={keys} goToKeys={() => setView("keys")} />
        ) : view === "keys" ? (
          <KeysView keys={keys} reloadKeys={reloadKeys} />
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

function Overview({ session, usage, keys, goToKeys }: { session: Session; usage: Usage | null; keys: ApiKey[]; goToKeys: () => void }) {
  const u = usage || { tier: session.tier, quota: 0, used: 0, remaining: 0 };
  const pct = u.quota ? Math.min(100, Math.round((u.used / u.quota) * 100)) : 0;
  const color = pct >= 90 ? "danger" : pct >= 70 ? "warning" : "accent";
  return (
    <>
      <PageTitle title="Dashboard" description={`Welcome back, ${session.email}.`} />
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
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent keys</h2>
          <Button size="sm" variant="secondary" onPress={goToKeys}>Manage keys</Button>
        </div>
        {keys.length ? (
          <KeyTable keys={keys.slice(0, 3)} />
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
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Quick start</h2>
        <CodeBlock title="curl" code={`curl -H "Authorization: Bearer mk_..." \\\n  "https://md.genedai.me/https://example.com?raw=true"`} />
      </section>
    </>
  );
}

function KeyTable({ keys, onRevoke }: { keys: ApiKey[]; onRevoke?: (id: string) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
                      isPending={busy === k.id}
                      onPress={async () => {
                        if (confirming !== k.id) {
                          setConfirming(k.id);
                          return;
                        }
                        setBusy(k.id);
                        await onRevoke(k.id);
                        setBusy(null);
                        setConfirming(null);
                      }}
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

function KeysView({ keys, reloadKeys }: { keys: ApiKey[]; reloadKeys: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setBanner(null);
    try {
      const resp = await api.json("/api/keys", "POST", { name: name.trim() });
      const data = (await resp.json().catch(() => ({}))) as { key?: string; message?: string; error?: string };
      if (!resp.ok || !data.key) {
        setBanner({ status: "danger", text: data.message || data.error || "Failed to create key" });
        return;
      }
      setSaved(false);
      setNewKey(data.key);
      setName("");
      await reloadKeys();
    } catch {
      setBanner({ status: "danger", text: "Network error. Try again." });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    const resp = await api.json(`/api/keys/${encodeURIComponent(id)}`, "DELETE").catch(() => null);
    if (resp?.ok) await reloadKeys();
    else setBanner({ status: "danger", text: "Could not revoke the key." });
    return Boolean(resp?.ok);
  };

  return (
    <>
      <PageTitle title="API Keys" description="Up to 10 active keys per account. The full key is shown once, when you create it." />
      {banner ? (
        <Alert status={banner.status}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{banner.text}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Card>
        <Card.Content>
          <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField className="flex-1" name="key-name" value={name} onChange={setName} maxLength={80}>
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
      {keys.length ? (
        <KeyTable keys={keys} onRevoke={revoke} />
      ) : (
        <p className="text-muted">No keys yet. Name one above and create it.</p>
      )}

      <Modal.Backdrop isOpen={newKey !== null} isDismissable={false} isKeyboardDismissDisabled>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Key className="size-5" />
              </Modal.Icon>
              <Modal.Heading>Save your API key</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <p className="text-sm text-muted">This is the only time you'll see the full key. Store it somewhere safe.</p>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-secondary p-3">
                <code className="flex-1 font-mono text-sm break-all">{newKey}</code>
                <CopyButton text={newKey || ""} variant="secondary" />
              </div>
              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>If you lose it, revoke it and create another.</Alert.Description>
                </Alert.Content>
              </Alert>
              <Checkbox isSelected={saved} onChange={setSaved}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  I have saved this key securely
                </Checkbox.Content>
              </Checkbox>
            </Modal.Body>
            <Modal.Footer>
              <Button isDisabled={!saved} onPress={() => setNewKey(null)}>Close</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

function SettingsView({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [pending, setPending] = useState(false);
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
        <Card.Footer>
          <Button
            variant="danger-soft"
            isPending={pending}
            onPress={async () => {
              setPending(true);
              await api.json("/api/auth/logout", "POST").catch(() => null);
              onSignOut();
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
