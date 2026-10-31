import {
  ArrowRight,
  ArrowUpRightFromSquare,
  Bars,
  BookOpen,
  CircleCheck,
  Code,
  FaceRobot,
  FileText,
  Layers,
  Lock,
  Magnifier,
  PlugConnection,
  Sparkles,
  Terminal,
  Thunderbolt,
} from "@gravity-ui/icons";
import {
  Accordion,
  Button,
  Card,
  Chip,
  Dropdown,
  InputGroup,
  Label,
  Separator,
  Table,
  Tabs,
  TextField,
} from "@heroui/react";
import { useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import type { Lang, SitePage } from "../contract";
import { COPY, type Copy } from "../copy";
import { Brand, CodeBlock, GithubButton, GITHUB_URL, LinkButton, SectionHeading, ThemeSwitcher } from "../components/ui";

export interface LandingProps {
  host: string;
  lang: Lang;
  page: SitePage;
}

export const PLATFORMS = [
  "WeChat", "Zhihu", "Feishu", "Yuque", "Juejin", "CSDN", "36Kr", "Toutiao",
  "Weibo", "NetEase", "Twitter/X", "Reddit", "Notion", "GitHub", "Substack", "Medium",
];

const PAGE_PATH: Record<SitePage, string> = {
  home: "/",
  examples: "/examples",
  docs: "/docs",
  integration: "/integrations",
};

export function langHref(pathname: string, lang: Lang): string {
  if (lang === "zh") return pathname === "/" ? "/?lang=zh" : `${pathname}?lang=zh`;
  return pathname === "/" ? "/?lang=en" : pathname;
}

export function landingCopy(lang: Lang, host: string): Copy {
  const raw = COPY[lang];
  const out = {} as Copy;
  for (const key of Object.keys(raw) as (keyof Copy)[]) out[key] = raw[key].replaceAll("{host}", host);
  return out;
}

type Ctx = { t: Copy; host: string; lang: Lang; isZh: boolean; stay: (path: string) => string };

export function LandingPage({ host, lang, page }: LandingProps) {
  const isZh = lang === "zh";
  const t = landingCopy(lang, host);
  const stay = (path: string) => (isZh ? langHref(path, "zh") : path);
  const ctx: Ctx = { t, host, lang, isZh, stay };
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <SiteHeader ctx={ctx} page={page} />
      <main className="flex-1">
        {page === "home" ? <HomePage ctx={ctx} /> : null}
        {page === "examples" ? <ExamplesPage ctx={ctx} /> : null}
        {page === "docs" ? <DocsPage ctx={ctx} /> : null}
        {page === "integration" ? <IntegrationPage ctx={ctx} /> : null}
      </main>
      <SiteFooter ctx={ctx} page={page} />
    </div>
  );
}

/* ───────────────────────── Chrome ───────────────────────── */

function SiteHeader({ ctx, page }: { ctx: Ctx; page: SitePage }) {
  const { t, host, isZh, stay } = ctx;
  const nav: { page: SitePage; label: string }[] = [
    { page: "home", label: t.tabHome },
    { page: "examples", label: isZh ? "示例" : "Examples" },
    { page: "docs", label: t.tabDocs },
    { page: "integration", label: t.tabIntegration },
  ];
  const themeLabels = { light: t.footerThemeLight, dark: t.footerThemeDark, system: t.footerThemeSystem, title: t.themeLabel };
  return (
    <header className="sticky top-0 z-40 border-b border-separator bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand host={host} href={stay("/")} />
        <nav aria-label={isZh ? "主导航" : "Main"} className="ml-4 hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <LinkButton
              key={item.page}
              href={stay(PAGE_PATH[item.page])}
              variant={item.page === page ? "secondary" : "ghost"}
              size="sm"
              aria-current={item.page === page ? "page" : undefined}
            >
              {item.label}
            </LinkButton>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <LangSwitch ctx={ctx} page={page} />
          <ThemeSwitcher labels={themeLabels} />
          <span className="hidden sm:inline-flex">
            <GithubButton />
          </span>
          <LinkButton href="/portal/" size="sm" className="hidden sm:inline-flex">
            {t.portalLabel}
          </LinkButton>
          <Dropdown>
            <Button isIconOnly variant="ghost" size="sm" aria-label={isZh ? "菜单" : "Menu"} className="md:hidden">
              <Bars className="size-4" />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu aria-label={isZh ? "菜单" : "Menu"}>
                {nav.map((item) => (
                  <Dropdown.Item key={item.page} id={item.page} href={stay(PAGE_PATH[item.page])} textValue={item.label}>
                    <Label>{item.label}</Label>
                  </Dropdown.Item>
                ))}
                <Dropdown.Item id="portal" href="/portal/" textValue={t.portalLabel}>
                  <Label>{t.portalLabel}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="github" href={GITHUB_URL} textValue="GitHub">
                  <Label>GitHub</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}

function LangSwitch({ ctx, page }: { ctx: Ctx; page: SitePage }) {
  const path = PAGE_PATH[page];
  const items: { lang: Lang; label: string }[] = [
    { lang: "en", label: "EN" },
    { lang: "zh", label: "中文" },
  ];
  return (
    <nav aria-label={ctx.t.langSwitchAria} className="flex items-center rounded-full bg-default p-0.5 text-xs font-medium">
      {items.map((item) => {
        const active = item.lang === ctx.lang;
        return (
          <a
            key={item.lang}
            href={langHref(path, item.lang)}
            hrefLang={item.lang}
            aria-current={active ? "true" : undefined}
            data-lang-link={item.lang}
            className={
              active
                ? "rounded-full bg-surface px-2.5 py-1 text-foreground shadow-sm"
                : "rounded-full px-2.5 py-1 text-muted hover:text-foreground"
            }
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function SiteFooter({ ctx }: { ctx: Ctx; page: SitePage }) {
  const { t, host, isZh, stay } = ctx;
  const cols: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
      title: t.footerProduct,
      links: [
        { label: isZh ? "示例" : "Examples", href: stay("/examples") },
        { label: isZh ? "文档" : "Docs", href: stay("/docs") },
        { label: isZh ? "参数" : "Parameters", href: `${stay("/docs")}#params` },
        { label: "Health", href: "/api/health" },
      ],
    },
    {
      title: t.footerIntegration,
      links: [
        { label: "Agent Skills", href: `${stay("/integrations")}#skills` },
        { label: "MCP", href: `${stay("/integrations")}#mcp` },
        { label: "llms.txt", href: "/llms.txt" },
        { label: "npm", href: "https://www.npmjs.com/package/@digidai/mcp-website2markdown", external: true },
      ],
    },
    {
      title: t.footerOpenSource,
      links: [
        { label: "GitHub", href: GITHUB_URL, external: true },
        { label: "Apache-2.0", href: "https://www.apache.org/licenses/LICENSE-2.0", external: true },
        { label: t.footerContributing, href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`, external: true },
        { label: t.footerSecurity, href: `${GITHUB_URL}/security`, external: true },
      ],
    },
  ];
  return (
    <footer className="border-t border-separator bg-surface-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col gap-3">
          <Brand host={host} href={stay("/")} />
          <p className="max-w-xs text-sm leading-6 text-muted">{t.schemaDescription}</p>
        </div>
        {cols.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">{col.title}</p>
            {col.links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-muted transition-colors hover:text-foreground"
                {...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <Separator />
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 text-xs text-muted sm:px-6">
        <span>© {new Date().getUTCFullYear()} Digidai</span>
        <span>Apache-2.0</span>
      </div>
    </footer>
  );
}

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

function PageIntro({ title, description, eyebrow }: { title: string; description: string; eyebrow?: string }) {
  return (
    <section className="border-b border-separator bg-surface-secondary/40">
      <Container className="py-14 sm:py-20">
        {eyebrow ? <p className="mb-3 text-sm font-semibold text-accent">{eyebrow}</p> : null}
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-pretty text-muted">{description}</p>
      </Container>
    </section>
  );
}

/* ───────────────────────── Home ───────────────────────── */

function HomePage({ ctx }: { ctx: Ctx }) {
  const { t, isZh, stay } = ctx;
  const features: { icon: ComponentType<{ className?: string }>; title: string; desc: string }[] = [
    { icon: Lock, title: t.why1Title, desc: t.why1Desc },
    { icon: FaceRobot, title: t.why2Title, desc: t.why2Desc },
    { icon: Layers, title: t.why3Title, desc: t.why3Desc },
  ];
  const useCases: { icon: ComponentType<{ className?: string }>; title: string; desc: string }[] = [
    { icon: FaceRobot, title: t.uc1Title, desc: t.uc1Desc },
    { icon: BookOpen, title: t.uc2Title, desc: t.uc2Desc },
    { icon: FileText, title: t.uc3Title, desc: t.uc3Desc },
    { icon: Magnifier, title: t.uc4Title, desc: t.uc4Desc },
    { icon: Sparkles, title: t.uc5Title, desc: t.uc5Desc },
    { icon: Code, title: t.uc6Title, desc: t.uc6Desc },
  ];
  const steps = [
    { title: t.step1Title, desc: t.step1Desc },
    { title: t.step2Title, desc: t.step2Desc },
    { title: t.step3Title, desc: t.step3Desc },
  ];
  const layers = [
    { name: t.layer1Name, meta: t.layer1Meta },
    { name: t.layer2Name, meta: t.layer2Meta },
    { name: t.layer3Name, meta: t.layer3Meta },
    { name: t.layer4Name, meta: t.layer4Meta },
    { name: t.layer5Name, meta: t.layer5Meta },
  ];
  const paths = [
    { href: stay("/"), icon: ArrowRight, title: isZh ? "手头有一个链接" : "You have a link", desc: isZh ? "贴到上面。Markdown 会在下一页打开。" : "Paste it above. Markdown opens on the next page." },
    { href: stay("/integrations"), icon: PlugConnection, title: isZh ? "Agent 要自己读网页" : "An agent should read the web", desc: isZh ? "Skills、MCP，或让它读 llms.txt。" : "Skills, MCP, or point it at llms.txt." },
    { href: stay("/docs"), icon: Terminal, title: isZh ? "要接进自己的流程" : "You are wiring a pipeline", desc: isZh ? "批量、提取、任务和深爬在文档里。密钥在门户。" : "Batch, extract, jobs, and deep crawl are in the docs. Keys live in the portal." },
  ];
  const faqs = [
    { q: t.faq1Q, a: t.faq1A },
    { q: t.faq2Q, a: t.faq2A },
    { q: t.faq3Q, a: t.faq3A },
    { q: t.faq4Q, a: t.faq4A },
    { q: t.faq5Q, a: t.faq5A },
    { q: t.faq6Q, a: t.faq6A },
  ];

  return (
    <>
      <Hero ctx={ctx} />

      <section className="border-y border-separator bg-surface-secondary/40 py-8">
        <Container className="flex flex-col items-center gap-4">
          <p className="text-sm font-medium text-muted">{t.platformsTitle}</p>
          <div className="flex max-w-4xl flex-wrap justify-center gap-2">
            {PLATFORMS.map((name) => (
              <Chip key={name} variant="secondary" size="lg">
                {name}
              </Chip>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14 sm:py-16">
        <Container>
          <SectionHeading
            eyebrow={isZh ? "效果" : "Proof"}
            title={isZh ? "打开链接时被拦住，返回的是正文" : "The link is blocked. The article comes back."}
            description={isZh ? "这是微信公众号的常见情况。左边是人看到的，右边是同一次转换返回的 Markdown。" : "A WeChat article, as people usually meet it. Left is the page. Right is the Markdown from the same conversion."}
          />
          <ExhibitTabs ctx={ctx} />
        </Container>
      </section>

      <section className="pb-14 sm:pb-16">
        <Container>
          <div className="grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, desc }) => (
              <Card key={title}>
                <Card.Header className="gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground">
                    <Icon className="size-5" />
                  </span>
                  <Card.Title className="text-lg">{title}</Card.Title>
                  <Card.Description className="leading-6">{desc}</Card.Description>
                </Card.Header>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-separator bg-surface-secondary/40 py-14 sm:py-16">
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow={t.howTitle} title={isZh ? "加一个前缀，剩下的交给边缘" : "One prefix. The edge does the rest."} />
            <ol className="flex flex-col gap-6">
              {steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                    {i + 1}
                  </span>
                  <div className="flex flex-col gap-1 pt-1">
                    <p className="font-semibold">{step.title}</p>
                    <p className="text-sm leading-6 text-muted">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Card className="self-start">
            <Card.Header>
              <Card.Title>{isZh ? "五层兜底" : "Five fallback layers"}</Card.Title>
              <Card.Description>{t.pipelineNote}</Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col">
              {layers.map((layer, i) => (
                <div key={layer.name}>
                  {i > 0 ? <Separator /> : null}
                  <div className="flex items-center gap-3 py-3">
                    <span className="font-mono text-xs text-muted">0{i + 1}</span>
                    <span className="flex-1 text-sm font-medium">{layer.name}</span>
                    <Chip size="sm" variant="soft" color={i < 2 ? "success" : i < 4 ? "accent" : "warning"}>
                      {layer.meta}
                    </Chip>
                  </div>
                </div>
              ))}
            </Card.Content>
          </Card>
        </Container>
      </section>

      <section className="py-14 sm:py-16">
        <Container>
          <SectionHeading title={t.useCasesTitle} center />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {useCases.map(({ icon: Icon, title, desc }) => (
              <Card key={title} variant="secondary">
                <Card.Header className="flex-row items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-accent" />
                  <div className="flex flex-col gap-1">
                    <Card.Title>{title}</Card.Title>
                    <Card.Description>{desc}</Card.Description>
                  </div>
                </Card.Header>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="pb-14 sm:pb-16">
        <Container>
          <SectionHeading title={isZh ? "按你现在要做的事" : "Pick up where you are"} />
          <div className="grid gap-4 md:grid-cols-3">
            {paths.map(({ href, icon: Icon, title, desc }) => (
              <a key={title} href={href} className="group block rounded-3xl focus-visible:outline-2 focus-visible:outline-focus">
                <Card className="h-full transition-shadow group-hover:shadow-lg">
                  <Card.Header className="gap-3">
                    <Icon className="size-5 text-accent" />
                    <Card.Title className="flex items-center gap-1.5">
                      {title}
                      <ArrowRight className="size-3.5 text-muted transition-transform group-hover:translate-x-0.5" />
                    </Card.Title>
                    <Card.Description>{desc}</Card.Description>
                  </Card.Header>
                </Card>
              </a>
            ))}
          </div>
        </Container>
      </section>

      <section id="faq" className="border-t border-separator bg-surface-secondary/40 py-14 sm:py-16">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <SectionHeading title={t.faqTitle} />
          <Accordion variant="surface" allowsMultipleExpanded>
            {faqs.map((faq, i) => (
              <Accordion.Item key={faq.q} id={`faq-${i + 1}`}>
                <Accordion.Heading>
                  <Accordion.Trigger>
                    {faq.q}
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="leading-7 text-muted">{faq.a}</Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Container>
      </section>

      <section className="py-14 sm:py-16">
        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-accent px-6 py-14 text-center text-accent-foreground sm:px-12">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t.ctaTitle}</h2>
            <p className="mx-auto mt-3 max-w-xl opacity-85">
              {isZh ? "免费注册即可使用浏览器渲染和更高额度。" : "A free key unlocks browser rendering and higher limits."}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <LinkButton href="/portal/" variant="secondary" size="lg">
                {t.portalLabel}
                <ArrowRight className="size-4" />
              </LinkButton>
              <LinkButton href={stay("/docs")} variant="ghost" size="lg" className="text-accent-foreground">
                {isZh ? "阅读文档" : "Read the docs"}
              </LinkButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

function Hero({ ctx }: { ctx: Ctx }) {
  const { t, host, isZh, stay } = ctx;
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const target = value.trim();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target) {
      setError(t.formError);
      return;
    }
    setError("");
    setPending(true);
    window.location.href = "/" + target;
  };

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[480px] max-w-4xl rounded-full bg-accent/15 blur-3xl"
      />
      <Container className="relative flex flex-col items-center py-16 text-center sm:py-20">
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          <Chip variant="soft" color="accent" size="lg">
            <Sparkles className="size-3.5" />
            {isZh ? "开源 · Apache-2.0 · 16 个平台适配器" : "Open source · Apache-2.0 · 16 platform adapters"}
          </Chip>
        </a>
        <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
          {t.heroTitleHtml}
        </h1>
        <p id="direct-answer" className="hero-subtitle mt-6 max-w-2xl text-lg leading-8 text-pretty text-muted">
          {t.heroSubtitle}
        </p>

        <form onSubmit={onSubmit} className="mt-10 flex w-full max-w-2xl flex-col gap-3 sm:flex-row" noValidate>
          <TextField
            aria-label={isZh ? "输入要转换的 URL" : "Enter URL to convert"}
            className="flex-1"
            name="url"
            value={value}
            onChange={(v) => {
              setValue(v);
              if (error) setError("");
            }}
            isInvalid={Boolean(error)}
            isDisabled={pending}
          >
            <InputGroup className="h-12">
              <InputGroup.Prefix className="hidden font-mono text-sm text-muted sm:flex">{host}/</InputGroup.Prefix>
              <InputGroup.Input
                id="urlInput"
                inputMode="url"
                placeholder={t.inputPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="text-base max-sm:ps-4"
              />
            </InputGroup>
          </TextField>
          <Button type="submit" size="lg" className="h-12 w-full sm:w-auto" isPending={pending}>
            {pending ? t.convertingButton : t.convertButton}
            {pending ? null : <ArrowRight className="size-4" />}
          </Button>
        </form>
        <p role="alert" className="mt-2 min-h-5 text-sm text-danger">{error}</p>
        <p className="max-w-2xl truncate font-mono text-xs text-muted" id="requestPreview">
          <span className="font-semibold text-accent">GET</span> https://{host}/{target || "https://example.com"}
        </p>
        <p className="mt-2 text-xs text-muted">{t.hintKeys}</p>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <LinkButton href="/https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/" variant="tertiary" size="sm">
            <Thunderbolt className="size-4" />
            {isZh ? "试一篇 Cloudflare 文档" : "Try a Cloudflare docs page"}
          </LinkButton>
          <LinkButton href={stay("/examples")} variant="tertiary" size="sm">
            {isZh ? "看打不开的页面" : "See pages that block you"}
          </LinkButton>
          <LinkButton href={stay("/docs")} variant="tertiary" size="sm">
            {isZh ? "接口文档" : "API reference"}
          </LinkButton>
        </div>
      </Container>
    </section>
  );
}

/* ───────────────────────── Exhibits ───────────────────────── */

function Compare({ ctx, blocked, markdown, note }: { ctx: Ctx; blocked: ReactNode; markdown: string; note?: string }) {
  const { t } = ctx;
  return (
    <div className="grid overflow-hidden rounded-2xl border border-border md:grid-cols-2">
      <div className="flex flex-col gap-3 bg-surface p-5 sm:p-6">
        <Chip size="sm" variant="soft" color="warning" className="self-start">
          {t.mockupLabelBlocked}
        </Chip>
        {blocked}
      </div>
      <div className="flex flex-col gap-3 border-t border-border bg-surface-secondary p-5 sm:p-6 md:border-t-0 md:border-l">
        <Chip size="sm" variant="soft" color="success" className="self-start">
          <CircleCheck className="size-3.5" />
          {t.mockupLabelClean}
        </Chip>
        <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">{markdown}</pre>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
    </div>
  );
}

function WechatExhibit({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  return (
    <Compare
      ctx={ctx}
      blocked={
        <>
          <p className="text-xs text-muted">{t.mockupWechatBadge}</p>
          <h3 className="text-lg font-semibold tracking-tight">{t.mockupArticleTitle}</h3>
          <p className="text-xs text-muted">{t.mockupAuthorDate}</p>
          <div className="mt-2 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface-secondary px-4 py-8 text-center">
            <Lock className="size-6 text-warning" />
            <p className="text-sm font-medium">{t.mockupWechatBlock}</p>
            <p className="text-xs text-muted">{t.mockupQrHint}</p>
          </div>
        </>
      }
      markdown={`# ${t.mockupArticleTitle}\n\n> ${t.mockupAuthorDate}\n\n## ${t.mockupH2KeyPoints}\n\n1. ${t.mockupBullet1}\n2. ${t.mockupBullet2}\n3. ${t.mockupBullet3}\n\n## ${t.mockupH2Background}\n\n${t.mockupBgParagraph}`}
    />
  );
}

function ZhihuExhibit({ ctx }: { ctx: Ctx }) {
  const { t } = ctx;
  return (
    <Compare
      ctx={ctx}
      blocked={
        <>
          <p className="text-xs text-muted">{t.mockupZhihuSlogan}</p>
          <h3 className="text-lg font-semibold tracking-tight">{t.mockupZhihuTitle}</h3>
          <p className="line-clamp-2 text-sm text-muted">{t.mockupZhihuContent}</p>
          <div className="mt-2 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface-secondary px-4 py-8 text-center">
            <Lock className="size-6 text-warning" />
            <p className="text-sm font-medium">{t.mockupLoginRequired}</p>
            <div className="flex gap-2">
              <span className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">{t.mockupLogin}</span>
              <span className="rounded-full bg-default px-3 py-1 text-xs">{t.mockupRegister}</span>
            </div>
          </div>
        </>
      }
      markdown={`# ${t.mockupZhihuAnswer}\n\n${t.mockupZhihuParagraph}\n\n## ${t.mockupZhihuH3}\n\n- ${t.mockupZhihuBullet1}\n- ${t.mockupZhihuBullet2}\n- ${t.mockupZhihuBullet3}`}
      note={t.mockupExtractedBadge}
    />
  );
}

function AgentExhibit({ ctx }: { ctx: Ctx }) {
  const { t, isZh } = ctx;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex justify-end">
        <p className="max-w-md rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-accent-foreground">
          {t.mockupChatUserMsg}
        </p>
      </div>
      <div className="flex max-w-full items-center gap-2 self-start rounded-xl border border-border bg-surface-secondary px-3 py-2 font-mono text-xs">
        <PlugConnection className="size-3.5 shrink-0 text-accent" />
        <span className="font-semibold">convert_url</span>
        <span className="min-w-0 truncate text-muted">url: https://mp.weixin.qq.com/s/abc123</span>
      </div>
      <div className="flex gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-default">
          <FaceRobot className="size-4" />
        </span>
        <div className="flex flex-col gap-2 text-sm leading-6">
          <p className="font-medium">{t.mockupChatSummaryIntro}</p>
          <ol className="list-decimal pl-5 text-muted">
            <li>{t.mockupChatPoint1}</li>
            <li>{t.mockupChatPoint2}</li>
            <li>{t.mockupChatPoint3}</li>
          </ol>
          <p className="text-muted">{t.mockupChatEnding}</p>
        </div>
      </div>
      <p className="sr-only">{isZh ? "Agent 调用示例" : "Agent call example"}</p>
    </div>
  );
}

function ExhibitTabs({ ctx }: { ctx: Ctx }) {
  const { isZh, t } = ctx;
  return (
    <Tabs defaultSelectedKey="wechat" className="w-full">
      <Tabs.ListContainer>
        <Tabs.List aria-label={isZh ? "示例" : "Examples"}>
          <Tabs.Tab id="wechat">
            {t.mockupWechatBadge}
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="zhihu">
            {isZh ? "知乎登录墙" : "Zhihu login wall"}
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="agent">
            {isZh ? "Agent 调用" : "An agent calling it"}
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="wechat" className="pt-6">
        <WechatExhibit ctx={ctx} />
      </Tabs.Panel>
      <Tabs.Panel id="zhihu" className="pt-6">
        <ZhihuExhibit ctx={ctx} />
      </Tabs.Panel>
      <Tabs.Panel id="agent" className="pt-6">
        <AgentExhibit ctx={ctx} />
      </Tabs.Panel>
    </Tabs>
  );
}

function ExamplesPage({ ctx }: { ctx: Ctx }) {
  const { t, isZh, stay } = ctx;
  const items = [
    { id: "wechat", title: t.why1Title, desc: t.why1Desc, body: <WechatExhibit ctx={ctx} /> },
    {
      id: "zhihu",
      title: isZh ? "登录墙后面的全文" : "The rest of a login wall",
      desc: isZh ? "知乎这类页面会停在登录框。浏览器渲染把正文提出来，不需要你先注册。" : "Zhihu stops on a sign-in box. Browser rendering pulls the article out. You don't register first.",
      body: <ZhihuExhibit ctx={ctx} />,
    },
    { id: "agent", title: t.why2Title, desc: t.why2Desc, body: <AgentExhibit ctx={ctx} /> },
  ];
  return (
    <>
      <PageIntro
        eyebrow={isZh ? "示例" : "Examples"}
        title={isZh ? "这些页面平时读不到" : "Pages that usually stop you"}
        description={isZh ? "左边是打开链接时看到的，右边是同一次转换返回的 Markdown。" : "Left is what the link shows a person. Right is the Markdown from that same conversion."}
      />
      <Container className="flex flex-col gap-16 py-16">
        {items.map((item) => (
          <section key={item.id} id={item.id} className="grid scroll-mt-24 grid-cols-1 gap-6 lg:grid-cols-[0.8fr_1.6fr]">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">{item.title}</h2>
              <p className="leading-7 text-muted">{item.desc}</p>
            </div>
            {item.body}
          </section>
        ))}
        <div>
          <LinkButton href={stay("/")}>
            {isZh ? "拿一个链接试" : "Try a link"}
            <ArrowRight className="size-4" />
          </LinkButton>
        </div>
      </Container>
    </>
  );
}

/* ───────────────────────── Docs ───────────────────────── */

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function KeyValueTable({ label, rows, head }: { label: string; rows: [string, ReactNode][]; head?: [string, string] }) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            <Table.Column isRowHeader>{head?.[0] ?? label}</Table.Column>
            <Table.Column>{head?.[1] ?? ""}</Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map(([key, value]) => (
              <Table.Row key={key} id={key}>
                <Table.Cell>
                  <code className="font-mono text-[13px] whitespace-nowrap text-foreground">{key}</code>
                </Table.Cell>
                <Table.Cell className="text-muted">{value}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function DocsPage({ ctx }: { ctx: Ctx }) {
  const { t, host, isZh } = ctx;
  const toc = [
    { id: "quickstart", label: t.quickStartTitle },
    { id: "routes", label: t.apiTitle },
    { id: "params", label: t.queryParamsTitle },
    { id: "auth", label: t.authTitle },
    { id: "headers", label: t.responseHeadersTitle },
  ];
  const examples = [
    { title: t.curlRawComment, code: `curl -H "Accept: text/markdown" https://${host}/https://example.com` },
    { title: t.curlJsonComment, code: `curl "https://${host}/https://example.com?raw=true&format=json"` },
    { title: t.curlBatchComment, code: `curl -X POST https://${host}/api/batch \\\n  -H "Authorization: Bearer API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"urls":["https://example.com"]}'` },
    { title: t.curlExtract, code: `curl -X POST https://${host}/api/extract \\\n  -H "Authorization: Bearer API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"strategy":"css","url":"https://example.com","schema":{"fields":[{"name":"title","selector":"h1","type":"text","required":true}]}}'` },
    { title: t.curlCrawl, code: `curl -X POST https://${host}/api/deepcrawl \\\n  -H "Authorization: Bearer API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"seed":"https://example.com/docs","stream":true}'` },
  ];
  const routes: [string, string][] = [
    ["GET /{url}", t.apiGetDesc],
    ["GET /api/stream", t.streamDesc],
    ["POST /api/batch", t.batchDesc],
    ["POST /api/extract", t.extractDesc],
    ["POST /api/jobs", t.jobsDesc],
    ["POST /api/deepcrawl", t.deepcrawlDesc],
    ["GET /api/health", t.healthDesc],
    ["GET /api/og", t.ogDesc],
    ["GET /llms.txt", t.llmsTxtRouteDesc],
  ];
  const params: [string, string][] = [
    ["?raw=true", t.rawDesc],
    ["?format=", `${t.formatDesc} (markdown | html | text | json)`],
    ["?selector=.css", t.selectorDesc],
    ["?force_browser=true", t.forceBrowserDesc],
    ["?engine=jina|firecrawl|cf", t.engineDesc],
    ["?no_cache=true", t.noCacheDesc],
    ["?token=", t.tokenDesc],
  ];
  const headers: [string, string][] = [
    ["X-Markdown-Method", "native | readability+turndown | browser+readability+turndown | jina"],
    ["X-Cache-Status", "HIT | MISS"],
    ["X-Source-URL", t.sourceUrlDesc],
  ];
  return (
    <>
      <PageIntro
        eyebrow={t.tabDocs}
        title={isZh ? "接口" : "API"}
        description={isZh ? "在 URL 前加上本站域名就是一次转换。批量、提取、任务和深爬需要 API key。" : "Prepend this host to a URL to convert it. Batch, extract, jobs, and deep crawl need an API key."}
      />
      <Container className="grid gap-12 py-14 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label={isZh ? "本页目录" : "On this page"} className="sticky top-24 flex flex-col gap-1">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{isZh ? "本页目录" : "On this page"}</p>
            {toc.map((item) => (
              <a key={item.id} href={`#${item.id}`} className="rounded-lg px-2 py-1.5 text-sm text-muted transition-colors hover:bg-default hover:text-foreground">
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-col gap-14">
          <DocSection id="quickstart" title={t.quickStartTitle}>
            <div className="flex flex-col gap-4">
              {examples.map((ex) => (
                <CodeBlock key={ex.title} title={ex.title.replace(/^#\s*/, "")} code={ex.code} copyLabel={t.copyLabel} copiedLabel={t.copiedLabel} />
              ))}
            </div>
          </DocSection>
          <DocSection id="routes" title={t.apiTitle}>
            <KeyValueTable label={t.apiTitle} rows={routes} head={[t.apiRouteTitle, ""]} />
          </DocSection>
          <DocSection id="params" title={t.queryParamsTitle}>
            <KeyValueTable label={t.queryParamsTitle} rows={params} head={[isZh ? "参数" : "Parameter", ""]} />
          </DocSection>
          <DocSection id="auth" title={t.authTitle}>
            <div className="grid gap-4 md:grid-cols-2">
              <Card variant="secondary">
                <Card.Header>
                  <Chip size="sm" variant="soft" color="accent" className="self-start font-mono">PUBLIC_API_TOKEN</Chip>
                  <Card.Description className="mt-2">{t.publicAuthDesc}</Card.Description>
                </Card.Header>
              </Card>
              <Card variant="secondary">
                <Card.Header>
                  <Chip size="sm" variant="soft" color="warning" className="self-start font-mono">API_TOKEN</Chip>
                  <Card.Description className="mt-2">{t.privateAuthDesc}</Card.Description>
                </Card.Header>
              </Card>
            </div>
          </DocSection>
          <DocSection id="headers" title={t.responseHeadersTitle}>
            <KeyValueTable label={t.responseHeadersTitle} rows={headers} head={["Header", ""]} />
          </DocSection>
        </div>
      </Container>
    </>
  );
}

/* ───────────────────────── Integrations ───────────────────────── */

function IntegrationPage({ ctx }: { ctx: Ctx }) {
  const { t, host, isZh } = ctx;
  const skills = [
    { id: "claude", label: t.skillClaudeCode, cmd: t.skillClaudeCmd },
    { id: "codex", label: t.skillCodex, cmd: t.skillCodexCmd },
    { id: "gemini", label: t.skillGemini, cmd: t.skillGeminiCmd },
    { id: "openclaw", label: t.skillOpenClaw, cmd: t.skillOpenClawCmd },
  ];
  const mcpConfig = JSON.stringify(
    { mcpServers: { website2markdown: { command: "mcp-website2markdown", env: { WEBSITE2MARKDOWN_API_URL: `https://${host}` } } } },
    null,
    2,
  );
  const choices = [
    { icon: Terminal, href: "#skills", title: t.skillTitle, line: t.decisionSkills, desc: t.decisionYes },
    { icon: PlugConnection, href: "#mcp", title: t.mcpTitle, line: t.decisionNo, desc: t.mcpFor },
    { icon: FileText, href: "#llms", title: t.llmsTxtTitle, line: t.llmsTxtFor, desc: t.decisionAll },
  ];
  const comparison: [string, string, string, string][] = [
    [t.compLatency, t.compLatencyHigh, t.compLatencyMid, t.compLatencyHigh],
    [t.compContext, t.compContextHigh, t.compContextLow, t.compContextMid],
    [t.compInstall, t.compSkillsInstall, t.compMcpInstall, t.compLlmsInstall],
    [t.compBestFor, t.compSkillsBest, t.compMcpBest, t.compLlmsBest],
  ];
  return (
    <>
      <PageIntro
        eyebrow={t.integrationTitle}
        title={isZh ? "接到 Agent" : "Connect an agent"}
        description={isZh ? "有终端用 Skills。在 IDE 里用 MCP。任何能打开网页的系统读 llms.txt。" : "A terminal gets Skills. An IDE gets MCP. Anything that can open a web page can read llms.txt."}
      />
      <Container className="flex flex-col gap-16 py-14">
        <section>
          <h2 className="mb-6 text-2xl font-semibold tracking-tight">{t.decisionTreeTitle}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {choices.map(({ icon: Icon, href, title, line, desc }) => (
              <a key={title} href={href} className="group block rounded-3xl">
                <Card className="h-full transition-shadow group-hover:shadow-lg">
                  <Card.Header className="gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground">
                      <Icon className="size-5" />
                    </span>
                    <Card.Title>{title}</Card.Title>
                    <p className="text-sm font-medium">{line}</p>
                    <Card.Description>{desc}</Card.Description>
                  </Card.Header>
                </Card>
              </a>
            ))}
          </div>
        </section>

        <section id="skills" className="scroll-mt-24">
          <Card>
            <Card.Header>
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-xl">{t.skillTitle}</Card.Title>
                <Chip size="sm" variant="soft" color="accent">{t.skillFor}</Chip>
              </div>
              <Card.Description>{t.skillDesc}</Card.Description>
            </Card.Header>
            <Card.Content>
              <Tabs defaultSelectedKey="claude" variant="secondary">
                <Tabs.ListContainer>
                  <Tabs.List aria-label={t.skillTitle}>
                    {skills.map((s) => (
                      <Tabs.Tab key={s.id} id={s.id}>
                        {s.label}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>
                {skills.map((s) => (
                  <Tabs.Panel key={s.id} id={s.id} className="pt-4">
                    <CodeBlock code={s.cmd} title={s.label} copyLabel={t.copyLabel} copiedLabel={t.copiedLabel} />
                  </Tabs.Panel>
                ))}
              </Tabs>
            </Card.Content>
            <Card.Footer>
              <p className="text-sm text-muted">{t.skillNote}</p>
            </Card.Footer>
          </Card>
        </section>

        <section id="mcp" className="scroll-mt-24">
          <Card>
            <Card.Header>
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-xl">{t.mcpTitle}</Card.Title>
                <Chip size="sm" variant="soft" color="accent">{t.mcpFor}</Chip>
              </div>
              <Card.Description>{t.mcpDesc}</Card.Description>
            </Card.Header>
            <Card.Content className="grid gap-4 lg:grid-cols-2">
              <CodeBlock code={t.mcpCmd} title="npm" copyLabel={t.copyLabel} copiedLabel={t.copiedLabel} />
              <CodeBlock
                code={mcpConfig}
                title={`${t.mcpConfigTitle} (~/.claude/claude_desktop_config.json)`}
                copyLabel={t.copyLabel}
                copiedLabel={t.copiedLabel}
              />
            </Card.Content>
          </Card>
        </section>

        <section id="llms" className="scroll-mt-24">
          <Card>
            <Card.Header>
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-xl">{t.llmsTxtTitle}</Card.Title>
                <Chip size="sm" variant="soft" color="accent">{t.llmsTxtFor}</Chip>
              </div>
              <Card.Description>{t.llmsTxtDesc}</Card.Description>
            </Card.Header>
            <Card.Footer>
              <LinkButton href="/llms.txt" variant="secondary" size="sm">
                https://{host}/llms.txt
                <ArrowUpRightFromSquare className="size-3.5" />
              </LinkButton>
            </Card.Footer>
          </Card>
        </section>

        <section>
          <h2 className="mb-6 text-2xl font-semibold tracking-tight">{t.comparisonTitle}</h2>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={t.comparisonTitle}>
                <Table.Header>
                  <Table.Column isRowHeader> </Table.Column>
                  <Table.Column>Skills</Table.Column>
                  <Table.Column>MCP</Table.Column>
                  <Table.Column>llms.txt</Table.Column>
                </Table.Header>
                <Table.Body>
                  {comparison.map(([label, a, b, c]) => (
                    <Table.Row key={label} id={label}>
                      <Table.Cell className="font-medium">{label}</Table.Cell>
                      <Table.Cell>{a}</Table.Cell>
                      <Table.Cell>{b}</Table.Cell>
                      <Table.Cell>{c}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </section>
      </Container>
    </>
  );
}

