import { Check, Copy, Display, LogoGithub, Moon, Sun } from "@gravity-ui/icons";
import { Button, Dropdown, Label, buttonVariants, cn, useIsHydrated, useTheme } from "@heroui/react";
import { useState, type ReactNode } from "react";

export const GITHUB_URL = "https://github.com/Digidai/website2markdown";

/** An <a> styled as a HeroUI Button, for navigation that must work without JS. */
export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  isIconOnly,
  className,
  external,
  children,
  ...rest
}: {
  href: string;
  variant?: "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isIconOnly?: boolean;
  className?: string;
  external?: boolean;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <a
      href={href}
      className={cn(buttonVariants({ variant, size, isIconOnly }), className)}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

export function Brand({ host, href = "/" }: { host: string; href?: string }) {
  return (
    <a href={href} className="flex items-center gap-2.5 font-semibold tracking-tight text-foreground">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-accent font-mono text-sm font-bold text-accent-foreground"
      >
        M↓
      </span>
      <span className="truncate">{host}</span>
    </a>
  );
}

export function GithubButton() {
  return (
    <LinkButton href={GITHUB_URL} variant="ghost" size="sm" isIconOnly external aria-label="GitHub">
      <LogoGithub className="size-4" />
    </LinkButton>
  );
}

const THEME_ICON = { light: Sun, dark: Moon, system: Display } as const;
type ThemeName = keyof typeof THEME_ICON;

export function ThemeSwitcher({ labels }: { labels: Record<ThemeName | "title", string> }) {
  const { theme, setTheme } = useTheme("system");
  const hydrated = useIsHydrated();
  const current: ThemeName = hydrated && (theme === "light" || theme === "dark") ? theme : "system";
  const Icon = THEME_ICON[current];
  return (
    <Dropdown>
      <Button isIconOnly variant="ghost" size="sm" aria-label={`${labels.title}: ${labels[current]}`}>
        <Icon className="size-4" />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={labels.title}
          selectionMode="single"
          selectedKeys={new Set([current])}
          onAction={(key) => setTheme(String(key))}
        >
          {(Object.keys(THEME_ICON) as ThemeName[]).map((name) => {
            const ItemIcon = THEME_ICON[name];
            return (
              <Dropdown.Item key={name} id={name} textValue={labels[name]}>
                <ItemIcon className="size-4 text-muted" />
                <Label>{labels[name]}</Label>
                <Dropdown.ItemIndicator />
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "ghost",
  showLabel = false,
}: {
  text: string | (() => string);
  label?: string;
  copiedLabel?: string;
  variant?: "ghost" | "secondary" | "tertiary";
  showLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onPress = () => {
    const value = typeof text === "function" ? text() : text;
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  };
  const Icon = copied ? Check : Copy;
  return (
    <Button
      size="sm"
      variant={variant}
      isIconOnly={!showLabel}
      aria-label={copied ? copiedLabel : label}
      onPress={onPress}
    >
      <Icon className="size-4" />
      {showLabel ? (copied ? copiedLabel : label) : null}
    </Button>
  );
}

/** Monospace block with a copy button. `title` renders as a small caption bar. */
export function CodeBlock({
  code,
  title,
  copyLabel,
  copiedLabel,
  className,
}: {
  code: string;
  title?: string;
  copyLabel?: string;
  copiedLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface-secondary", className)}>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3">
        <span className="truncate text-xs font-medium text-muted">{title ?? ""}</span>
        <CopyButton text={code} label={copyLabel} copiedLabel={copiedLabel} />
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  center,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  center?: boolean;
}) {
  return (
    <div className={cn("mb-10 flex max-w-2xl flex-col gap-3", center && "mx-auto items-center text-center")}>
      {eyebrow ? <p className="text-sm font-semibold text-accent">{eyebrow}</p> : null}
      <h2 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">{title}</h2>
      {description ? <p className="text-base leading-7 text-pretty text-muted">{description}</p> : null}
    </div>
  );
}
