import { ArrowLeft, ArrowRotateRight, ArrowUpRightFromSquare, CircleCheck, TriangleExclamation } from "@gravity-ui/icons";
import { Button, Card, Chip, Spinner, Tabs, Typography } from "@heroui/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useReducer, useState } from "react";
import {
  conversionReducer,
  initialConversionState,
  RESULT_TIMEOUT_MS,
  stepDetail,
  stepRows,
  STREAM_TIMEOUT_MS,
  type ConversionEvent,
} from "../conversion-stream";
import { Brand, CopyButton, LinkButton, ThemeSwitcher } from "../components/ui";

const THEME_LABELS = { light: "Light", dark: "Dark", system: "System", title: "Theme" };

export interface ReaderProps {
  host: string;
  sourceUrl: string;
  rawRequestPath: string;
  /** The public method string, as in X-Markdown-Method ("browser+readability+turndown"). */
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
  /** What to try next. */
  hint?: string;
}

/** Text with its https links clickable. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/[^\s"]+)/).map((part, i) =>
        /^https:\/\//.test(part)
          ? <a key={i} href={part} className="text-accent underline underline-offset-2 break-all">{part}</a>
          : part)}
    </>
  );
}

type ChipColor = "accent" | "default" | "success" | "warning" | "danger";

export function methodInfo(method: string): { label: string; color: ChipColor } {
  if (method === "native") return { label: "Native Markdown", color: "success" };
  if (method.includes("browser")) return { label: "Browser Rendered", color: "accent" };
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

export function ErrorCard({ title, message, status, hint, onRetry }: ErrorProps & { onRetry?: () => void }) {
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
        {hint ? <p className="text-sm leading-6 text-muted"><Linked text={hint} /></p> : null}
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
      <TopBar host={props.host || "mdget.dev"} />
      <main className="grid flex-1 place-items-center px-4 py-16">
        <ErrorCard {...props} />
      </main>
    </div>
  );
}

export function LoadingPage({ host, targetUrl, streamUrl, rawRequestPath }: LoadingProps) {
  const [state, dispatch] = useReducer(conversionReducer, undefined, () => initialConversionState());
  const [elapsed, setElapsed] = useState(0);
  const { attempt, phase } = state;
  const running = phase === "streaming" || phase === "loadingResult";

  // One EventSource per attempt. It never reconnects by itself: each connection
  // to /api/stream starts a new conversion, so a dropped stream becomes an error.
  useEffect(() => {
    if (typeof EventSource === "undefined") {
      window.location.href = rawRequestPath;
      return;
    }
    const es = new EventSource(streamUrl);
    const end = (event: ConversionEvent) => {
      es.close();
      clearTimeout(timeout);
      dispatch(event);
    };
    const parse = (e: Event): unknown => {
      try {
        return JSON.parse((e as MessageEvent).data);
      } catch {
        return undefined;
      }
    };
    const timeout = setTimeout(() => end({ type: "timeout" }), STREAM_TIMEOUT_MS);
    es.addEventListener("step", (e) => dispatch({ type: "step", data: parse(e) }));
    es.addEventListener("done", (e) => end({ type: "done", data: parse(e) }));
    es.addEventListener("fail", (e) => end({ type: "fail", data: parse(e) }));
    es.onerror = () => end({ type: "connectionLost" });
    return () => {
      es.close();
      clearTimeout(timeout);
    };
  }, [attempt, rawRequestPath, streamUrl]);

  const done = phase === "loadingResult" || phase === "result" ? state.done : null;
  const rawUrl = done?.rawUrl || rawRequestPath;

  useEffect(() => {
    if (phase !== "loadingResult") return;
    if (done?.title) document.title = `${done.title} — ${host}`;
    let cancelled = false;
    const controller = new AbortController();
    // Aborting on timeout fails the load; aborting on cleanup does not.
    const timeout = setTimeout(() => controller.abort(), RESULT_TIMEOUT_MS);
    fetch(rawUrl, { headers: { Accept: "text/markdown" }, signal: controller.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((markdown) => dispatch({ type: "resultLoaded", markdown }))
      .catch(() => {
        if (!cancelled) dispatch({ type: "resultFailed" });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [phase, done, rawUrl, host]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running, attempt]);

  if (state.phase === "result") {
    return (
      <ReaderView
        host={host}
        sourceUrl={targetUrl}
        rawRequestPath={rawUrl}
        method={state.done.method || ""}
        cached={Boolean(state.done.cached)}
        tokenCount={state.done.tokenCount ? String(state.done.tokenCount) : ""}
        title={state.done.title || ""}
        content={state.markdown}
      />
    );
  }

  const error = state.phase === "failed" ? state.failure : null;
  const detail = stepDetail(state);
  const retry = () => {
    setElapsed(0);
    dispatch({ type: "retry" });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar host={host} />
      <main className="grid flex-1 place-items-center px-4 py-16">
        {error ? (
          <ErrorCard {...error} onRetry={error.retryable === false ? undefined : retry} />
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
                {stepRows(state).map((step) => (
                  <li key={step.id} className="flex items-center gap-3" data-state={step.status}>
                    <span className="grid size-5 place-items-center">
                      {step.status === "done" ? (
                        <CircleCheck className="size-5 text-success" />
                      ) : step.status === "active" ? (
                        <Spinner size="sm" />
                      ) : (
                        <span className="size-3.5 rounded-full border-2 border-border" />
                      )}
                    </span>
                    <span className={step.status === "pending" ? "text-sm text-muted" : "text-sm font-medium"}>{step.label}</span>
                  </li>
                ))}
              </ol>
              {detail ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted" aria-live="polite">
                  {phase === "loadingResult" ? <Spinner size="sm" /> : null}
                  {detail}…
                </p>
              ) : null}
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
