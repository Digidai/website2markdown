import { ArrowLeft, ArrowRotateRight, ArrowUpRightFromSquare, CircleCheck, TriangleExclamation } from "@gravity-ui/icons";
import { Button, Card, Chip, Spinner, Tabs, Typography } from "@heroui/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef, useState } from "react";
import { Brand, CopyButton, LinkButton, ThemeSwitcher } from "../components/ui";

const THEME_LABELS = { light: "Light", dark: "Dark", system: "System", title: "Theme" };

export interface ReaderProps {
  host: string;
  sourceUrl: string;
  rawRequestPath: string;
  /** Server method name ("browser") or the SSE method string ("browser+readability+turndown"). */
  method: string;
  cached: boolean;
  tokenCount: string;
  title: string;
  content: string;
}

export interface LoadingProps {
  host: string;
  targetUrl: string;
  streamUrl: string;
  rawRequestPath: string;
}

export interface ErrorProps {
  title: string;
  message: string;
  status?: number;
}

type ChipColor = "accent" | "default" | "success" | "warning" | "danger";

export function methodInfo(method: string): { label: string; color: ChipColor } {
  if (method === "native") return { label: "Native Markdown", color: "success" };
  if (method === "cloudflare") return { label: "Cloudflare REST", color: "success" };
  if (method === "proxy" || method.startsWith("proxy")) return { label: "Residential Proxy", color: "accent" };
  if (method.includes("browser")) return { label: "Browser Rendered", color: "accent" };
  if (method === "jina") return { label: "Jina Reader", color: "warning" };
  if (method === "firecrawl") return { label: "Firecrawl", color: "warning" };
  return { label: "Readability + Turndown", color: "default" };
}

function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string);
}

function TopBar({ host, children }: { host: string; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Brand host={host} />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {children}
          <ThemeSwitcher labels={THEME_LABELS} />
        </div>
      </div>
    </header>
  );
}

export function ReaderView(props: ReaderProps) {
  const { host, sourceUrl, rawRequestPath, method, cached, tokenCount, content } = props;
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    setHtml(renderMarkdown(content));
  }, [content]);
  const info = methodInfo(method);
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar host={host}>
        <Chip size="sm" variant="soft" color={info.color}>{info.label}</Chip>
        {cached ? <Chip size="sm" variant="soft" color="success">CACHED</Chip> : null}
        {tokenCount ? <Chip size="sm" variant="secondary">{tokenCount} tokens</Chip> : null}
        <CopyButton text={content} variant="secondary" showLabel />
        <LinkButton href={rawRequestPath} size="sm" external>
          Raw
          <ArrowUpRightFromSquare className="size-3.5" />
        </LinkButton>
      </TopBar>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={sourceUrl}
          className="mb-6 flex items-center gap-1.5 truncate text-sm text-muted hover:text-foreground"
        >
          <ArrowUpRightFromSquare className="size-3.5 shrink-0" />
          <span className="truncate">{sourceUrl}</span>
        </a>
        <Tabs defaultSelectedKey="rendered" variant="secondary">
          <Tabs.ListContainer>
            <Tabs.List aria-label="View">
              <Tabs.Tab id="rendered">
                Rendered
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="source">
                Source
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="rendered" className="pt-6">
            {html === null ? (
              <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap">{content}</pre>
            ) : (
              <Typography.Prose className="max-w-none break-words">
                <div
                  className="flex flex-col gap-4 [&_h1,&_h2,&_h3]:mt-4 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-sm [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-surface-secondary [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:font-semibold"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </Typography.Prose>
            )}
          </Tabs.Panel>
          <Tabs.Panel id="source" className="pt-6">
            <pre className="scrollbar-thin overflow-x-auto rounded-xl border border-border bg-surface-secondary p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
              {content}
            </pre>
          </Tabs.Panel>
        </Tabs>
      </main>
    </div>
  );
}

export function ErrorCard({ title, message, status, onRetry }: ErrorProps & { onRetry?: () => void }) {
  return (
    <Card className="w-full max-w-md">
      <Card.Header className="gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-danger-soft text-danger">
          <TriangleExclamation className="size-5" />
        </span>
        {status ? (
          <Chip size="sm" variant="soft" color="danger" className="self-start font-mono">{String(status)}</Chip>
        ) : null}
        <Card.Title className="text-xl">{title}</Card.Title>
        <Card.Description className="leading-6">{message}</Card.Description>
      </Card.Header>
      <Card.Footer className="gap-2">
        {onRetry ? (
          <Button onPress={onRetry}>
            <ArrowRotateRight className="size-4" />
            Retry
          </Button>
        ) : null}
        <LinkButton href="/" variant={onRetry ? "secondary" : "primary"}>
          <ArrowLeft className="size-4" />
          Back to home
        </LinkButton>
      </Card.Footer>
    </Card>
  );
}

export function ErrorPage(props: ErrorProps & { host?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar host={props.host || "md.genedai.me"} />
      <main className="grid flex-1 place-items-center px-4 py-16">
        <ErrorCard {...props} />
      </main>
    </div>
  );
}

const STEPS = [
  { id: "fetch", label: "Fetching page" },
  { id: "analyze", label: "Analyzing content" },
  { id: "browser", label: "Rendering with browser" },
  { id: "convert", label: "Converting to Markdown" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

interface DoneEvent {
  method?: string;
  cached?: boolean;
  tokenCount?: number | string;
  rawUrl?: string;
  title?: string;
}

export function LoadingPage({ host, targetUrl, streamUrl, rawRequestPath }: LoadingProps) {
  const [active, setActive] = useState<StepId>("fetch");
  const [usedBrowser, setUsedBrowser] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ErrorProps | null>(null);
  const [result, setResult] = useState<ReaderProps | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      window.location.href = rawRequestPath;
      return;
    }
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    const es = new EventSource(streamUrl);
    const finish = () => {
      handled.current = true;
      es.close();
      clearInterval(timer);
      clearTimeout(timeout);
    };
    const timeout = setTimeout(() => {
      if (handled.current) return;
      finish();
      setError({ title: "Timeout", message: "The conversion is taking too long. Please try again.", status: 504 });
    }, 90000);

    es.addEventListener("step", (e) => {
      if (handled.current) return;
      const id = JSON.parse((e as MessageEvent).data).id as StepId;
      if (id === "browser") setUsedBrowser(true);
      setActive(id);
    });
    es.addEventListener("done", (e) => {
      if (handled.current) return;
      finish();
      const data = JSON.parse((e as MessageEvent).data) as DoneEvent;
      setActive("done" as StepId);
      const rawUrl = data.rawUrl || rawRequestPath;
      if (data.title) document.title = `${data.title} — ${host}`;
      fetch(rawUrl, { headers: { Accept: "text/markdown" } })
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((md) =>
          setResult({
            host,
            sourceUrl: targetUrl,
            rawRequestPath: rawUrl,
            method: data.method || "",
            cached: Boolean(data.cached),
            tokenCount: data.tokenCount ? String(data.tokenCount) : "",
            title: data.title || "",
            content: md,
          }),
        )
        .catch(() =>
          setError({ title: "Could not load the result", message: "The conversion finished but the Markdown failed to load. Try the Raw link." }),
        );
    });
    es.addEventListener("fail", (e) => {
      if (handled.current) return;
      finish();
      setError(JSON.parse((e as MessageEvent).data) as ErrorProps);
    });
    es.onerror = () => {
      if (handled.current) return;
      if (es.readyState === EventSource.CLOSED) {
        finish();
        setError({ title: "Connection Lost", message: "Lost connection to the server. Please try again." });
      }
    };
    return () => {
      es.close();
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, [host, rawRequestPath, streamUrl, targetUrl]);

  if (result) return <ReaderView {...result} />;

  const visible = STEPS.filter((s) => s.id !== "browser" || usedBrowser);
  const activeIndex = (active as string) === "done" ? visible.length : visible.findIndex((s) => s.id === active);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar host={host} />
      <main className="grid flex-1 place-items-center px-4 py-16">
        {error ? (
          <ErrorCard {...error} onRetry={() => window.location.reload()} />
        ) : (
          <Card className="w-full max-w-md">
            <Card.Header className="gap-2">
              <Card.Title className="text-xl">Converting</Card.Title>
              <Card.Description className="truncate font-mono text-xs" title={targetUrl}>
                {targetUrl}
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <ol className="flex flex-col gap-3">
                {visible.map((step, i) => {
                  const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
                  return (
                    <li key={step.id} className="flex items-center gap-3" data-state={state}>
                      <span className="grid size-5 place-items-center">
                        {state === "done" ? (
                          <CircleCheck className="size-5 text-success" />
                        ) : state === "active" ? (
                          <Spinner size="sm" />
                        ) : (
                          <span className="size-3.5 rounded-full border-2 border-border" />
                        )}
                      </span>
                      <span className={state === "pending" ? "text-sm text-muted" : "text-sm font-medium"}>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
            </Card.Content>
            <Card.Footer className="justify-between">
              <span className="font-mono text-xs text-muted tabular-nums">{elapsed}s elapsed</span>
              <LinkButton href="/" variant="ghost" size="sm">
                Back to home
              </LinkButton>
            </Card.Footer>
          </Card>
        )}
      </main>
    </div>
  );
}
