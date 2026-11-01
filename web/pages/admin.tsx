import {
  ArrowLeft,
  ArrowRightFromSquare,
  ArrowRotateRight,
  ArrowUpRightFromSquare,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleXmark,
  Eye,
  EyeSlash,
  Funnel,
  ListUl,
  Lock,
  Magnifier,
  PlugConnection,
  TriangleExclamation,
} from "@gravity-ui/icons";
import {
  Alert,
  Button,
  Card,
  Chip,
  Disclosure,
  Input,
  InputGroup,
  Label,
  ListBox,
  Meter,
  Select,
  Separator,
  Spinner,
  Table,
  Tabs,
  TextField,
  Typography,
  cn,
} from "@heroui/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState, type ReactNode } from "react";
import { Brand, CopyButton, LinkButton, ThemeSwitcher } from "../components/ui";
import {
  ALERT_FAILURE_RATE,
  ALERT_MIN_ATTEMPTS,
  type AccessRow,
  type AdminChannel,
  type AdminQuery,
  type AdminReport,
  type AdminState,
  type AdminTab,
  type ChannelTestResult,
  type ConversionDetail,
  conversionFlag,
  type ConversionFlag,
  type ConversionRow,
  type DaySplit,
  type PairRow,
  type ProviderPathHealth,
  type SuspiciousIp,
} from "../contract";

const THEME_LABELS = { light: "浅色", dark: "深色", system: "跟随系统", title: "主题" };
const PAGE_SIZE = 40;
const DAY_CHOICES = [1, 7, 14, 30, 90];
const SURFACE_LABEL: Record<string, string> = {
  page: "页面",
  api: "API",
  account: "账号",
  asset: "资产",
  probe: "探测",
  admin: "后台",
  other: "其他",
};
type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

export function AdminPage(state: AdminState) {
  if (state.mode === "login") return <Login error={state.error} />;
  if (state.mode === "detail") return <Detail detail={state.detail} back={state.back} />;
  return <Dashboard report={state.report} channels={state.channels} tab={state.tab} />;
}

// ─── Shared helpers ─────────────────────────────────────────

function when(iso: string): string {
  return iso ? iso.slice(5, 16).replace("T", " ") : "—";
}

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

function rate(row: Pick<ProviderPathHealth, "attempts" | "failures">): number {
  return row.attempts > 0 ? row.failures / row.attempts : 0;
}

function unhealthy(row: ProviderPathHealth | null): boolean {
  return Boolean(row && row.attempts >= ALERT_MIN_ATTEMPTS && rate(row) >= ALERT_FAILURE_RATE);
}

const FLAG_CHIP: Record<ConversionFlag, { label: string; color: ChipColor }> = {
  fail: { label: "失败", color: "danger" },
  warn: { label: "异常", color: "warning" },
  ok: { label: "成功", color: "success" },
};

function FlagChip({ flag }: { flag: ConversionFlag }) {
  const chip = FLAG_CHIP[flag];
  return <Chip size="sm" variant="soft" color={chip.color} className="whitespace-nowrap">{chip.label}</Chip>;
}

export function adminHref(query: AdminQuery, patch: Partial<AdminQuery> & { tab?: AdminTab } = {}): string {
  const { tab, ...rest } = patch;
  const next = { ...query, ...rest };
  const params = new URLSearchParams();
  if (tab && tab !== "overview") params.set("tab", tab);
  if (next.days !== 14) params.set("days", String(next.days));
  if (next.view !== "all") params.set("view", next.view);
  if (next.outcome) params.set("outcome", next.outcome);
  if (next.route) params.set("route", next.route);
  if (next.platform) params.set("platform", next.platform);
  if (next.surface) params.set("surface", next.surface);
  if (next.status != null) params.set("status", String(next.status));
  if (next.q) params.set("q", next.q);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.apage > 1) params.set("apage", String(next.apage));
  const search = params.toString();
  return search ? `/admin?${search}` : "/admin";
}

function externalHref(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const readerPath = (url: string) => `/${encodeURIComponent(url)}`;
const rawPath = (url: string) => `/${encodeURIComponent(url)}?raw=true`;

function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string);
}

function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-x-3 px-4 py-2 sm:px-6">
        <Brand host="md.genedai.me" href="/admin" />
        <Chip size="sm" variant="soft" color="accent" className="max-sm:hidden">运营后台</Chip>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {children}
          <ThemeSwitcher labels={THEME_LABELS} />
        </div>
      </div>
    </header>
  );
}

function LogoutButton() {
  return (
    <form method="post" action="/admin/logout">
      <Button type="submit" size="sm" variant="ghost">
        <ArrowRightFromSquare className="size-4" />
        <span className="max-sm:hidden">退出</span>
      </Button>
    </form>
  );
}

// ─── Login ──────────────────────────────────────────────────

function Login({ error }: { error?: string }) {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [next, setNext] = useState("/admin");
  useEffect(() => {
    setNext(location.pathname === "/admin" ? location.pathname + location.search : "/admin");
  }, []);
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <Card className="w-full max-w-sm">
          <Card.Header className="items-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Lock className="size-5" />
            </span>
            <Card.Title className="text-2xl">运营后台</Card.Title>
            <Card.Description>输入管理口令，查看访问、使用数据和渠道状态。</Card.Description>
          </Card.Header>
          <form method="post" action="/admin" onSubmit={() => setPending(true)}>
            <Card.Content className="flex flex-col gap-4">
              {error ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
              <input type="hidden" name="next" value={next} />
              <TextField isRequired name="password" type={visible ? "text" : "password"} autoComplete="current-password" isInvalid={Boolean(error)}>
                <Label>口令</Label>
                <InputGroup>
                  <InputGroup.Input placeholder="ADMIN_PASSWORD" autoFocus />
                  <InputGroup.Suffix className="pr-1">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label={visible ? "隐藏口令" : "显示口令"}
                      onPress={() => setVisible((v) => !v)}
                    >
                      {visible ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </InputGroup.Suffix>
                </InputGroup>
              </TextField>
              <Button type="submit" fullWidth isPending={pending}>
                {pending ? <Spinner size="sm" color="current" /> : null}
                进入后台
              </Button>
            </Card.Content>
          </form>
          <Card.Footer className="justify-center">
            <p className="text-center text-xs text-muted">连续输错 8 次会锁定 15 分钟。登录状态保留 12 小时。</p>
          </Card.Footer>
        </Card>
      </main>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────

function Dashboard({ report, channels, tab: initialTab }: { report: AdminReport; channels: AdminChannel[]; tab: AdminTab }) {
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const query = report.query;
  const select = (key: AdminTab) => {
    setTab(key);
    const url = new URL(location.href);
    if (key === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    history.replaceState(null, "", url.pathname + url.search);
  };
  const failing = channels.filter((c) => unhealthy(c.health));
  const missing = channels.filter((c) => c.status === "missing");
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar>
        <DaysSelect query={query} tab={tab} />
        <LinkButton href={adminHref(query, { tab })} size="sm" variant="ghost" isIconOnly aria-label="刷新" className="max-sm:hidden">
          <ArrowRotateRight className="size-4" />
        </LinkButton>
        <LogoutButton />
      </TopBar>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">运营统计</h1>
          <p className="text-sm text-muted">最近 {query.days} 天 · 记录保留 90 天 · 密钥、邮箱和口令已脱敏</p>
        </div>
        {report.error ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>读取统计失败</Alert.Title>
              <Alert.Description>{report.error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {failing.length ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{failing.length} 个渠道失败率过高</Alert.Title>
              <Alert.Description>{failing.map((c) => `${c.name} 失败 ${Math.round(rate(c.health!) * 100)}%（${c.health!.failures}/${c.health!.attempts}）`).join("，")}</Alert.Description>
            </Alert.Content>
            <Button size="sm" variant="danger" onPress={() => select("channels")}>查看渠道</Button>
          </Alert>
        ) : null}
        <Tabs selectedKey={tab} onSelectionChange={(key) => select(key as AdminTab)}>
          <Tabs.ListContainer className="overflow-x-auto">
            <Tabs.List aria-label="后台分区">
              <Tabs.Tab id="overview" className="gap-1.5 whitespace-nowrap">
                <ChartColumn className="size-4 max-sm:hidden" />概览
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="channels" className="gap-1.5 whitespace-nowrap">
                <PlugConnection className="size-4 max-sm:hidden" />渠道
                {failing.length || missing.length ? (
                  <Chip size="sm" variant="soft" color={failing.length ? "danger" : "warning"}>{failing.length || missing.length}</Chip>
                ) : null}
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="conversions" className="gap-1.5 whitespace-nowrap">
                <ListUl className="size-4 max-sm:hidden" />转换记录
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="requests" className="gap-1.5 whitespace-nowrap">
                <Funnel className="size-4 max-sm:hidden" />请求记录
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="overview" className="pt-6">
            <Overview report={report} onShowFailures={() => { location.href = adminHref(query, { tab: "conversions", view: "failures", page: 1 }); }} />
          </Tabs.Panel>
          <Tabs.Panel id="channels" className="pt-6">
            <Channels channels={channels} days={query.days} />
          </Tabs.Panel>
          <Tabs.Panel id="conversions" className="pt-6">
            <Conversions report={report} />
          </Tabs.Panel>
          <Tabs.Panel id="requests" className="pt-6">
            <Requests report={report} />
          </Tabs.Panel>
        </Tabs>
      </main>
    </div>
  );
}

function DaysSelect({ query, tab }: { query: AdminQuery; tab: AdminTab }) {
  return (
    <Select
      aria-label="时间范围"
      className="w-24 sm:w-28"
      value={String(query.days)}
      onChange={(key) => { location.href = adminHref(query, { tab, days: Number(key), page: 1, apage: 1 }); }}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {DAY_CHOICES.map((d) => (
            <ListBox.Item key={d} id={String(d)} textValue={`${d} 天`}>
              {d === 1 ? "今天" : `${d} 天`}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

// ─── Overview ───────────────────────────────────────────────

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "warning" | "success" }) {
  return (
    <Card>
      <Card.Content className="flex flex-col gap-1">
        <span className="text-sm text-muted">{label}</span>
        <span className={cn("text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>
          {value}
        </span>
        {sub ? <span className="text-xs text-muted">{sub}</span> : null}
      </Card.Content>
    </Card>
  );
}

function Overview({ report, onShowFailures }: { report: AdminReport; onShowFailures: () => void }) {
  const d = report.query.days;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid *:min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="API 访问" value={fmt(report.apiWindow)} sub={`今日 ${fmt(report.apiToday)} · 错误 ${fmt(report.apiErrors)}`} />
        <Stat label="使用记录" value={fmt(report.conversionsWindow)} sub={`今日 ${fmt(report.conversionsToday)}`} />
        <Stat label="有效结果" value={fmt(report.usefulWindow)} sub={`今日 ${fmt(report.usefulToday)} · 正文 ≥ 800 字`} tone={report.usefulWindow ? "success" : undefined} />
        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Meter value={report.successRate} color={report.successRate >= 80 ? "success" : report.successRate >= 50 ? "warning" : "danger"} aria-label="成功率">
              <Label className="text-sm font-normal text-muted">成功率</Label>
              <Meter.Output className="text-2xl font-semibold tabular-nums text-foreground" />
              <Meter.Track>
                <Meter.Fill />
              </Meter.Track>
            </Meter>
            <span className="text-xs text-muted">失败 {fmt(report.failures)} · 异常 {fmt(report.anomalies)}</span>
          </Card.Content>
        </Card>
      </div>
      <div className="grid *:min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="页面访问" value={fmt(report.pagesWindow)} sub={`今日 ${fmt(report.pagesToday)} · 错误 ${fmt(report.pageErrors)}`} />
        <Stat label="匿名 / 账户使用" value={`${fmt(report.anonUsage)} / ${fmt(report.signedUsage)}`} sub={report.conversionsWindow ? `匿名占 ${Math.round((report.anonUsage / report.conversionsWindow) * 100)}%` : undefined} />
        <Stat label="账户 / 有效密钥" value={`${fmt(report.accounts)} / ${fmt(report.keys)}`} sub={`${d} 日账户额度 ${fmt(report.ledgerRequests)} 次`} />
        <Stat label="其他请求" value={fmt(report.accountWindow + report.probeWindow + report.assetWindow)} sub={`账号 ${fmt(report.accountWindow)} · 探测 ${fmt(report.probeWindow)} · 资产 ${fmt(report.assetWindow)}`} />
      </div>

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-2">
          <Card.Title>每日使用记录</Card.Title>
          <div className="flex items-center gap-3 text-xs text-muted">
            <Legend className="bg-success" label="成功" />
            <Legend className="bg-warning" label="异常" />
            <Legend className="bg-danger" label="失败" />
          </div>
        </Card.Header>
        <Card.Content>
          <DayChart rows={report.conversionDays} />
        </Card.Content>
      </Card>

      <div className="grid *:min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="使用结果" rows={report.outcomes} color={(l) => (l === "success" ? "bg-success" : "bg-danger")} />
        <Breakdown title="失败原因" rows={report.errorCodes} color={() => "bg-danger"} />
        <Breakdown title="平台" rows={report.platforms} />
        <Breakdown title="身份" rows={report.authTiers} />
        <Breakdown title="来源 IP" rows={report.topIps ?? []} mono />
        <Breakdown title="API 路径" rows={report.apiPaths} mono />
        <Breakdown title="页面路径" rows={report.pagePaths} mono />
      </div>

      <SuspiciousIps rows={report.suspiciousIps ?? []} query={report.query} />

      <Card>
        <Card.Header className="flex-row items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <Card.Title>最近的失败与异常</Card.Title>
            <Card.Description>异常：成功但正文为空、走了回退、超过 30 秒或遇到付费墙。</Card.Description>
          </div>
          <Button size="sm" variant="secondary" onPress={onShowFailures}>查看全部</Button>
        </Card.Header>
        <Card.Content>
          {report.failurePreview.length ? (
            <ConversionTable rows={report.failurePreview} query={report.query} compact />
          ) : (
            <p className="py-6 text-center text-sm text-muted">这个范围内没有失败或异常。</p>
          )}
        </Card.Content>
      </Card>

      <Disclosure>
        <Disclosure.Heading>
          <Button slot="trigger" variant="ghost" size="sm">
            指标口径
            <Disclosure.Indicator />
          </Button>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="max-w-3xl text-sm leading-6 text-muted">
            页面访问只计首页、示例、文档、接入和门户。API 访问只计转换地址和产品接口；账号接口、探测、图标和后台在「其他请求」里。
            使用记录是逐条转换结果，带原文。失败：结果不是 success，或状态码 ≥ 400。账户额度只计带密钥的调用，和逐条使用记录不是同一套数字。
            小时汇总 {fmt(report.aggregateRequests)} 条是更早的按小时计数，没有单条链接。
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </div>
  );
}

function SuspiciousIps({ rows, query }: { rows: SuspiciousIp[]; query: AdminQuery }) {
  return (
    <Card>
      <Card.Header className="flex flex-col gap-1">
        <Card.Title>可疑 IP</Card.Title>
        <Card.Description>近 24 小时的匿名请求，按规则打分：3 分起为可疑，6 分起为滥用。目前只观察，不拦截。</Card.Description>
      </Card.Header>
      <Card.Content>
        {rows.length ? (
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="可疑 IP" className="min-w-[760px]">
                <Table.Header>
                  <Table.Column isRowHeader>IP</Table.Column>
                  <Table.Column>级别</Table.Column>
                  <Table.Column>请求 / 转换 / 失败</Table.Column>
                  <Table.Column>原因</Table.Column>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <Table.Row key={row.ip} id={row.ip}>
                      <Table.Cell className="max-w-[260px]">
                        <a
                          href={adminHref({ ...query, q: row.ip, page: 1, apage: 1 }, { tab: "conversions" })}
                          className="block truncate font-mono text-sm font-medium text-foreground hover:text-accent"
                          title="查看这个 IP 的转换记录"
                        >
                          {row.ip}
                        </a>
                        <span className="block truncate text-xs text-muted">
                          {[row.country, row.asn ? `AS${row.asn}` : "", row.as_org, row.ua_family].filter(Boolean).join(" · ")}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft" color={row.level === "abuse" ? "danger" : "warning"} className="whitespace-nowrap">
                          {row.level === "abuse" ? "滥用" : "可疑"} · {row.score}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-muted tabular-nums">
                        {fmt(row.requests)} / {fmt(row.conversions)} / {fmt(row.failures)}
                      </Table.Cell>
                      <Table.Cell className="max-w-[420px] text-xs text-muted">{row.reasons.join("；")}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        ) : (
          <p className="py-6 text-center text-sm text-muted">近 24 小时没有可疑的匿名 IP。</p>
        )}
      </Card.Content>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={cn("size-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}

function DayChart({ rows }: { rows: DaySplit[] }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-muted">没有按日数据。</p>;
  const max = Math.max(1, ...rows.map((r) => r.ok + r.warn + r.bad));
  return (
    <div className="flex h-48 items-end gap-1 overflow-x-auto pb-6">
      {rows.map((row) => {
        const total = row.ok + row.warn + row.bad;
        return (
          <div key={row.day} className="group relative flex h-full min-w-6 max-w-12 flex-1 flex-col justify-end" title={`${row.day}：成功 ${row.ok}，异常 ${row.warn}，失败 ${row.bad}`}>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${(total / max) * 100}%` }}>
              <i className="bg-success" style={{ height: `${total ? (row.ok / total) * 100 : 0}%` }} />
              <i className="bg-warning" style={{ height: `${total ? (row.warn / total) * 100 : 0}%` }} />
              <i className="bg-danger" style={{ height: `${total ? (row.bad / total) * 100 : 0}%` }} />
            </div>
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted">{row.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Breakdown({ title, rows, color, mono }: { title: string; rows: PairRow[]; color?: (label: string) => string; mono?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card>
      <Card.Header>
        <Card.Title className="text-base">{title}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2.5">
        {rows.length ? rows.slice(0, 8).map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cn("truncate", mono && "font-mono text-xs")} title={row.label}>{row.label || "—"}</span>
              <span className="shrink-0 tabular-nums text-muted">{fmt(row.n)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-secondary">
              <i className={cn("block h-full rounded-full", color ? color(row.label) : "bg-accent")} style={{ width: `${Math.max(2, (row.n / max) * 100)}%` }} />
            </div>
          </div>
        )) : <p className="py-4 text-center text-sm text-muted">没有数据</p>}
      </Card.Content>
    </Card>
  );
}

// ─── Channels ───────────────────────────────────────────────

const CHANNEL_STATUS: Record<AdminChannel["status"], { label: string; color: ChipColor }> = {
  active: { label: "已配置", color: "success" },
  missing: { label: "未配置", color: "warning" },
  disabled: { label: "已停用", color: "default" },
};

function Channels({ channels, days }: { channels: AdminChannel[]; days: number }) {
  const counts = {
    active: channels.filter((c) => c.status === "active").length,
    missing: channels.filter((c) => c.status === "missing").length,
    disabled: channels.filter((c) => c.status === "disabled").length,
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Chip size="sm" variant="soft" color="success">已配置 {counts.active}</Chip>
        <Chip size="sm" variant="soft" color="warning">未配置 {counts.missing}</Chip>
        <Chip size="sm" variant="soft">已停用 {counts.disabled}</Chip>
        <span className="ml-1">
          成功率按 {days} 天统计。调用 ≥ {ALERT_MIN_ATTEMPTS} 次且失败率 ≥ {Math.round(ALERT_FAILURE_RATE * 100)}% 会标红，并在每天的定时任务里发邮件告警。「测试」会实时请求一次 example.com。
        </span>
      </div>
      <div className="grid *:min-w-0 gap-4 lg:grid-cols-2">
        {channels.map((channel) => <ChannelCard key={channel.id} channel={channel} />)}
      </div>
    </div>
  );
}

function ChannelCard({ channel }: { channel: AdminChannel }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ChannelTestResult | null>(null);
  const status = CHANNEL_STATUS[channel.status];
  const health = channel.health;
  const successPct = health ? Math.round((1 - rate(health)) * 100) : 0;
  const bad = unhealthy(health);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const resp = await fetch("/admin/channels/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channel.id }),
      });
      setResult(resp.ok
        ? ((await resp.json()) as ChannelTestResult)
        : { ok: false, ms: 0, summary: resp.status === 401 ? "登录已过期，请刷新页面重新登录。" : `HTTP ${resp.status}`, details: [] });
    } catch (error) {
      setResult({ ok: false, ms: 0, summary: error instanceof Error ? error.message : "请求失败", details: [] });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className={cn(bad && "ring-1 ring-danger/40")}>
      <Card.Header className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-base">{channel.name}</Card.Title>
          <Card.Description>{channel.role}</Card.Description>
        </div>
        <Chip size="sm" variant="soft" color={status.color} className="shrink-0">{status.label}</Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className={cn("text-sm", channel.status === "active" ? "text-muted" : "text-warning")}>{channel.statusNote}</p>
          {channel.env.length ? (
            <div className="flex flex-wrap gap-1.5">
              {channel.env.map((v) => (
                <Chip key={v.name} size="sm" variant={v.set ? "soft" : "tertiary"} color={v.set ? "success" : v.required ? "danger" : "default"}>
                  {v.set ? <CircleCheck className="size-3" /> : <CircleXmark className="size-3" />}
                  <span className="font-mono text-[11px]">{v.name}</span>
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">无需配置。</p>
          )}
        </div>
        <Separator />
        {health ? (
          <div className="flex flex-col gap-2">
            <Meter value={successPct} color={bad ? "danger" : health.failures ? "warning" : "success"} aria-label="成功率" size="sm">
              <Label className="text-sm font-normal text-muted">成功率 · {fmt(health.attempts)} 次调用，失败 {fmt(health.failures)}</Label>
              <Meter.Output className="tabular-nums" />
              <Meter.Track>
                <Meter.Fill />
              </Meter.Track>
            </Meter>
            {health.lastError ? (
              <p className="line-clamp-2 font-mono text-xs break-all text-danger" title={health.lastError}>
                {when(health.lastFailureAt)} · {health.lastError}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">这段时间没有调用记录。</p>
        )}
        {result ? (
          <Alert status={result.ok ? "success" : "danger"}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{result.ok ? "测试通过" : "测试失败"}{result.ms ? ` · ${fmt(result.ms)} ms` : ""}</Alert.Title>
              <Alert.Description className="flex flex-col gap-1">
                {!result.ok ? <span className="font-mono text-xs break-all">{result.summary}</span> : null}
                {result.details.map((line) => <span key={line} className="text-xs break-all">{line}</span>)}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </Card.Content>
      {channel.testable ? (
        <Card.Footer>
          <Button size="sm" variant="secondary" isPending={testing} onPress={runTest}>
            {testing ? <Spinner size="sm" color="current" /> : <PlugConnection className="size-4" />}
            {testing ? "测试中…" : "测试"}
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}

// ─── Conversions ────────────────────────────────────────────

function Pager({ page, total, href }: { page: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
      <span className="text-sm text-muted">共 {fmt(total)} 条 · 第 {page} / {pages} 页</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <LinkButton href={href(page - 1)} size="sm" variant="secondary"><ChevronLeft className="size-4" />上一页</LinkButton>
        ) : <Button size="sm" variant="secondary" isDisabled><ChevronLeft className="size-4" />上一页</Button>}
        {page < pages ? (
          <LinkButton href={href(page + 1)} size="sm" variant="secondary">下一页<ChevronRight className="size-4" /></LinkButton>
        ) : <Button size="sm" variant="secondary" isDisabled>下一页<ChevronRight className="size-4" /></Button>}
      </div>
    </div>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <Select name={name} defaultValue={value || options[0][0]} className="w-full sm:w-40">
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, text]) => (
            <ListBox.Item key={id || "all"} id={id} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function FilterField({ name, label, value, placeholder, className }: { name: string; label: string; value: string; placeholder: string; className?: string }) {
  return (
    <TextField name={name} defaultValue={value} className={cn("w-full sm:w-40", className)}>
      <Label>{label}</Label>
      <Input placeholder={placeholder} />
    </TextField>
  );
}

function Filters({ query, tab, children }: { query: AdminQuery; tab: AdminTab; children: ReactNode }) {
  const active = Boolean(query.outcome || query.route || query.platform || query.surface || query.status != null || query.q || query.view !== "all");
  return (
    <Card variant="secondary">
      <Card.Content>
        <form method="get" action="/admin" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value={tab} />
          {query.days !== 14 ? <input type="hidden" name="days" value={query.days} /> : null}
          {children}
          <TextField name="q" defaultValue={query.q} className="w-full sm:w-64">
            <Label>搜索</Label>
            <InputGroup>
              <InputGroup.Prefix><Magnifier className="size-4 text-muted" /></InputGroup.Prefix>
              <InputGroup.Input placeholder="链接、路径、错误" maxLength={80} />
            </InputGroup>
          </TextField>
          <div className="flex gap-2">
            <Button type="submit">筛选</Button>
            {active ? <LinkButton href={adminHref({ ...query, view: "all", outcome: "", route: "", platform: "", surface: "", status: null, q: "", page: 1, apage: 1 }, { tab })} variant="ghost">清除</LinkButton> : null}
          </div>
        </form>
      </Card.Content>
    </Card>
  );
}

function Conversions({ report }: { report: AdminReport }) {
  const query = report.query;
  return (
    <div className="flex flex-col gap-4">
      <Filters query={query} tab="conversions">
        <FilterSelect name="view" label="记录" value={query.view === "failures" ? "failures" : "all"} options={[["all", "全部"], ["failures", "失败与异常"]]} />
        <FilterSelect name="outcome" label="结果" value={query.outcome} options={[["", "全部结果"], ["success", "success"], ["convert_error", "convert_error"], ["unexpected_error", "unexpected_error"]]} />
        <FilterSelect name="route" label="路由" value={query.route} options={[["", "全部路由"], ["convert", "convert"], ["stream", "stream"]]} />
        <FilterField name="platform" label="平台" value={query.platform} placeholder="wechat" />
        <FilterField name="status" label="状态码" value={query.status == null ? "" : String(query.status)} placeholder="502" className="sm:w-28" />
      </Filters>
      <Card>
        <Card.Content>
          <ConversionTable rows={report.conversions} query={query} />
          <Pager page={query.page} total={report.conversionTotal} href={(page) => adminHref(query, { tab: "conversions", page })} />
        </Card.Content>
      </Card>
    </div>
  );
}

function ConversionTable({ rows, query, compact }: { rows: ConversionRow[]; query: AdminQuery; compact?: boolean }) {
  const back = adminHref(query, { tab: compact ? "overview" : "conversions" });
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="转换记录" className="min-w-[760px]">
          <Table.Header>
            <Table.Column>时间</Table.Column>
            <Table.Column>状态</Table.Column>
            <Table.Column isRowHeader>链接</Table.Column>
            <Table.Column>过程</Table.Column>
            <Table.Column>错误 / 正文</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <p className="py-8 text-center text-sm text-muted">没有匹配的转换记录。</p>}>
            {rows.map((row) => {
              const detail = `/admin/conversion?id=${encodeURIComponent(row.id)}&back=${encodeURIComponent(back)}`;
              const meta = [row.method_used, row.cache_status, `${fmt(row.duration_ms)} ms`, row.auth_tier, row.country, row.client_ip].filter(Boolean).join(" · ");
              return (
                <Table.Row key={row.id} id={row.id}>
                  <Table.Cell className="whitespace-nowrap text-muted tabular-nums"><span title={row.created_at}>{when(row.created_at)}</span></Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-1">
                      <FlagChip flag={conversionFlag(row)} />
                      <span className="text-xs text-muted tabular-nums">{row.status_code}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[340px]">
                    <a href={detail} className="block truncate font-medium text-foreground hover:text-accent" title={row.target_url}>
                      {row.target_host || row.target_url}
                    </a>
                    <span className="block truncate font-mono text-xs text-muted" title={row.target_url}>{row.target_url}</span>
                  </Table.Cell>
                  <Table.Cell className="max-w-[220px]">
                    <span className="block truncate text-xs text-muted" title={meta}>{meta}</span>
                    {row.fallbacks ? <span className="block truncate font-mono text-[11px] text-warning" title={row.fallbacks}>{row.fallbacks}</span> : null}
                  </Table.Cell>
                  <Table.Cell className="max-w-[320px]">
                    {row.error_code || row.error_message ? (
                      <span className="line-clamp-2 text-xs text-danger" title={row.error_message}>{[row.error_code, row.error_message].filter(Boolean).join(" · ")}</span>
                    ) : (
                      <span className="line-clamp-2 text-xs text-muted">{row.output_excerpt ? row.output_excerpt.slice(0, 160) : row.output_chars === 0 ? "没有返回正文" : "正文未保存"}</span>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

// ─── Requests ───────────────────────────────────────────────

function Requests({ report }: { report: AdminReport }) {
  const query = report.query;
  return (
    <div className="flex flex-col gap-4">
      <Filters query={query} tab="requests">
        <FilterSelect name="surface" label="类别" value={query.surface} options={[["", "全部类别"], ...Object.entries(SURFACE_LABEL)]} />
        <FilterField name="status" label="状态码" value={query.status == null ? "" : String(query.status)} placeholder="404" className="sm:w-28" />
      </Filters>
      <Card>
        <Card.Content>
          <AccessTable rows={report.accesses} />
          <Pager page={query.apage} total={report.accessTotal} href={(apage) => adminHref(query, { tab: "requests", apage })} />
        </Card.Content>
      </Card>
    </div>
  );
}

function AccessTable({ rows }: { rows: AccessRow[] }) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="请求记录" className="min-w-[860px]">
          <Table.Header>
            <Table.Column>时间</Table.Column>
            <Table.Column>状态</Table.Column>
            <Table.Column>类别</Table.Column>
            <Table.Column isRowHeader>路径</Table.Column>
            <Table.Column>耗时</Table.Column>
            <Table.Column>来源</Table.Column>
            <Table.Column>客户端</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <p className="py-8 text-center text-sm text-muted">没有匹配的请求记录。</p>}>
            {rows.map((row, i) => (
              <Table.Row key={`${row.created_at}-${i}`} id={`${row.created_at}-${i}`}>
                <Table.Cell className="whitespace-nowrap text-muted tabular-nums"><span title={row.created_at}>{when(row.created_at)}</span></Table.Cell>
                <Table.Cell>
                  <Chip size="sm" variant="soft" color={row.status >= 500 ? "danger" : row.status >= 400 ? "warning" : "success"}>{row.status}</Chip>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap">
                  {SURFACE_LABEL[row.surface || ""] || row.surface || "—"}
                  {row.route_name ? <span className="block text-xs text-muted">{row.route_name}{row.format ? ` · ${row.format}` : ""}</span> : null}
                </Table.Cell>
                <Table.Cell className="max-w-[360px]">
                  <span className="block truncate font-mono text-xs" title={row.query_redacted ? `${row.path}?${row.query_redacted}` : row.path}>
                    <span className="text-muted">{row.method} </span>{row.path}
                  </span>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-muted tabular-nums">{row.duration_ms == null ? "—" : `${fmt(row.duration_ms)} ms`}</Table.Cell>
                <Table.Cell className="max-w-[160px] truncate text-muted">{row.referrer_host || "—"}</Table.Cell>
                <Table.Cell className="whitespace-nowrap text-muted">
                  <span title={[row.user_agent, row.as_org, row.city].filter(Boolean).join("\n")}>
                    {[row.client_ip, row.ua_family, row.country, row.auth_present && row.auth_present !== "none" ? row.auth_present : ""].filter(Boolean).join(" · ")}
                  </span>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

// ─── Detail ─────────────────────────────────────────────────

function yesNo(value: number | null | undefined, yes = "是", no = "否"): string {
  if (value == null) return "未记录";
  return value ? yes : no;
}

function Detail({ detail, back }: { detail: ConversionDetail; back: string }) {
  const row = detail.row;
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (row?.output_excerpt) setHtml(renderMarkdown(row.output_excerpt));
  }, [row?.output_excerpt]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <TopBar>
        <LogoutButton />
      </TopBar>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <div>
          <LinkButton href={back} size="sm" variant="ghost"><ArrowLeft className="size-4" />返回列表</LinkButton>
        </div>
        {!row ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>找不到这条记录</Alert.Title>
              <Alert.Description>{detail.error || "记录不存在或已超过 90 天保留期。"}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <DetailBody row={row} html={html} />
        )}
      </main>
    </div>
  );
}

function DetailBody({ row, html }: { row: ConversionRow; html: string | null }) {
  const flag = conversionFlag(row);
  const original = externalHref(row.target_url);
  const groups: { title: string; fields: [string, string][] }[] = [
    {
      title: "结果",
      fields: [
        ["结果", row.outcome],
        ["状态码", String(row.status_code)],
        ["错误码", row.error_code || "—"],
        ["正文字数", row.output_chars == null ? "未记录" : fmt(row.output_chars)],
        ["付费墙", yesNo(row.paywall)],
        ["浏览器渲染", yesNo(row.browser_rendered)],
      ],
    },
    {
      title: "过程",
      fields: [
        ["时间", row.created_at.replace("T", " ").slice(0, 19)],
        ["路由", row.route],
        ["方法", row.method_used || "—"],
        ["回退", row.fallbacks || "—"],
        ["缓存", row.cache_status || "—"],
        ["耗时", `${fmt(row.duration_ms)} ms`],
        ["引擎", row.engine_requested || "—"],
        ["格式", row.format || "—"],
        ["内容类型", row.content_type || "—"],
        ["请求 ID", row.request_id || "—"],
      ],
    },
    {
      title: "调用方",
      fields: [
        ["身份", row.auth_tier || "—"],
        ["IP", row.client_ip || "—"],
        ["网络", [row.asn ? `AS${row.asn}` : "", row.as_org].filter(Boolean).join(" ") || "—"],
        ["国家 / 城市 / 机房", [row.country, row.city, row.colo].filter(Boolean).join(" / ") || "—"],
        ["客户端", row.user_agent || row.ua_family || "—"],
        ["账户 ID / 密钥 ID", [row.account_id, row.key_id].filter(Boolean).join(" / ") || "—"],
        ["额度", row.credit_cost == null ? "未记录" : String(row.credit_cost)],
        ["剩余额度档", row.quota_bucket || "—"],
        ["选择器 / 强制浏览器 / 跳过缓存", `${yesNo(row.selector_present, "有", "无")} / ${yesNo(row.force_browser)} / ${yesNo(row.no_cache)}`],
        ["账户哈希", row.account_hash || "—"],
        ["密钥哈希", row.key_hash || "—"],
      ],
    },
  ];
  return (
    <>
      <Card>
        <Card.Header className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FlagChip flag={flag} />
            <Chip size="sm" variant="secondary">{row.platform || "generic"}</Chip>
            <span className="text-sm text-muted">{row.target_host}</span>
          </div>
          <Card.Title className="text-xl break-all">{row.target_url}</Card.Title>
          {row.error_message ? (
            <Alert status="danger">
              <Alert.Indicator><TriangleExclamation className="size-4" /></Alert.Indicator>
              <Alert.Content>
                <Alert.Description className="break-all">{row.error_message}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </Card.Header>
        <Card.Footer className="flex-wrap gap-2">
          {original ? <LinkButton href={original} size="sm" variant="secondary" external>原站<ArrowUpRightFromSquare className="size-3.5" /></LinkButton> : null}
          <LinkButton href={readerPath(row.target_url)} size="sm" variant="secondary" external>阅读页<ArrowUpRightFromSquare className="size-3.5" /></LinkButton>
          <LinkButton href={rawPath(row.target_url)} size="sm" variant="secondary" external>Markdown<ArrowUpRightFromSquare className="size-3.5" /></LinkButton>
          <CopyButton text={row.target_url} label="复制链接" copiedLabel="已复制" variant="ghost" showLabel />
        </Card.Footer>
      </Card>

      <div className="grid *:min-w-0 gap-4 md:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.title}>
            <Card.Header>
              <Card.Title className="text-base">{group.title}</Card.Title>
            </Card.Header>
            <Card.Content>
              <dl className="flex flex-col gap-2.5 text-sm">
                {group.fields.map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="font-medium break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card.Content>
          </Card>
        ))}
      </div>

      <Card>
        <Card.Header>
          <Card.Title className="text-base">转换结果</Card.Title>
          {row.output_excerpt && row.output_chars != null && row.output_chars > row.output_excerpt.length ? (
            <Card.Description>摘录 {fmt(row.output_excerpt.length)} / {fmt(row.output_chars)} 字，全文在阅读页。</Card.Description>
          ) : null}
        </Card.Header>
        <Card.Content>
          {!row.output_excerpt ? (
            <p className="py-6 text-center text-sm text-muted">
              {row.output_chars === 0 ? "没有返回正文。" : "正文未保存。打开阅读页可以重新转换。"}
            </p>
          ) : (
            <Tabs defaultSelectedKey="rendered" variant="secondary">
              <Tabs.ListContainer>
                <Tabs.List aria-label="正文视图">
                  <Tabs.Tab id="rendered">渲染<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="source">Markdown<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="rendered" className="pt-4">
                {html === null ? (
                  <pre className="font-mono text-sm whitespace-pre-wrap">{row.output_excerpt}</pre>
                ) : (
                  <Typography.Prose className="max-w-none break-words">
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                  </Typography.Prose>
                )}
              </Tabs.Panel>
              <Tabs.Panel id="source" className="pt-4">
                <pre className="scrollbar-thin max-h-[600px] overflow-auto rounded-xl border border-border bg-surface-secondary p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
                  {row.output_excerpt}
                </pre>
              </Tabs.Panel>
            </Tabs>
          )}
        </Card.Content>
      </Card>
    </>
  );
}
