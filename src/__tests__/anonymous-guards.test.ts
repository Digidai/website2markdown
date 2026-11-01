import { describe, expect, it } from "vitest";
import {
  isGovCnHost,
  isGovEmptyShell,
  isGovNotFoundUrl,
  isNegativeOriginStatus,
  anonymousBlockMessage,
  isSearchResultPage,
  PROXY_SERVICE_API_KEY_MESSAGE,
  SEARCH_PAGE_API_KEY_MESSAGE,
  notFoundPhraseDominates,
} from "../policy/anonymous-guards";

const GOV = "https://www.mof.gov.cn/zhengce/2024/notice.html";

describe("anonymous search pages", () => {
  it("matches only the exact search paths", () => {
    expect(isSearchResultPage("https://www.bing.com/search?q=test")).toBe(true);
    expect(isSearchResultPage("https://searx.be/search?q=test")).toBe(true);
    expect(isSearchResultPage("https://html.duckduckgo.com/html/")).toBe(true);
    expect(isSearchResultPage("https://html.duckduckgo.com/html")).toBe(true);
    expect(isSearchResultPage("https://priv.au/search?q=site%3Abruker.com")).toBe(true);
    expect(isSearchResultPage("https://www.bing.com/images/search?q=x")).toBe(true);
    expect(isSearchResultPage("https://search.brave.com/search?q=x")).toBe(true);
    expect(isSearchResultPage("https://www.google.com/search?q=x")).toBe(true);
    expect(isSearchResultPage("https://yandex.com/search/?text=x")).toBe(true);
    expect(isSearchResultPage("https://www.baidu.com/s?wd=x")).toBe(true);

    expect(isSearchResultPage("https://priv.au/")).toBe(false);
    expect(isSearchResultPage("https://www.bing.com/item/356355/abc")).toBe(false);
    expect(isSearchResultPage("https://www.google.com/maps/place/x")).toBe(false);
    // A site's own product search is not a search engine.
    expect(isSearchResultPage("https://www.targetmol.com/search?keyword=x")).toBe(false);

    expect(isSearchResultPage("https://www.bing.com/search/")).toBe(false);
    expect(isSearchResultPage("https://www.bing.com/Search?q=test")).toBe(false);
    expect(isSearchResultPage("https://www.bing.com/news")).toBe(false);
    expect(isSearchResultPage("https://cn.bing.com/search?q=test")).toBe(false);
    expect(isSearchResultPage("https://bing.com/search?q=test")).toBe(false);
    expect(isSearchResultPage("https://duckduckgo.com/")).toBe(false);
    expect(isSearchResultPage("https://html.duckduckgo.com/")).toBe(false);
    expect(isSearchResultPage("https://searx.be/search/")).toBe(false);
    expect(isSearchResultPage("https://openprescribing.net/chemical/")).toBe(false);
    expect(isSearchResultPage("https://arxiv.org/abs/1234.5678")).toBe(false);
    expect(isSearchResultPage("https://mp.weixin.qq.com/s/abc")).toBe(false);
    expect(isSearchResultPage("not a url")).toBe(false);
  });
});

describe("anonymous blocked targets", () => {
  it("names search pages and proxy services, and lets other pages through", () => {
    expect(anonymousBlockMessage("https://priv.au/search?q=x")).toBe(SEARCH_PAGE_API_KEY_MESSAGE);
    expect(anonymousBlockMessage("https://r.jina.ai/https://example.com")).toBe(PROXY_SERVICE_API_KEY_MESSAGE);
    expect(anonymousBlockMessage("https://api.microlink.io/?url=https://example.com")).toBe(PROXY_SERVICE_API_KEY_MESSAGE);
    expect(anonymousBlockMessage("https://jina.ai/reader")).toBeNull();
    expect(anonymousBlockMessage("https://web.archive.org/web/2024/https://example.com")).toBeNull();
    expect(anonymousBlockMessage("not a url")).toBeNull();
  });
});

describe("gov.cn empty shells", () => {
  it("recognizes gov.cn hosts and not-found locations without matching article ids", () => {
    expect(isGovCnHost("https://gov.cn/")).toBe(true);
    expect(isGovCnHost("https://www.gov.cn/")).toBe(true);
    expect(isGovCnHost("https://czt.gansu.gov.cn/art/1.html")).toBe(true);
    expect(isGovCnHost("https://WWW.MOF.GOV.CN/404.htm")).toBe(true);
    expect(isGovCnHost("https://evilgov.cn/404.htm")).toBe(false);
    expect(isGovCnHost("https://notgov.cn/")).toBe(false);
    expect(isGovCnHost("https://gov.cn.example.com/")).toBe(false);
    expect(isGovCnHost("https://mp.weixin.qq.com/s/abc")).toBe(false);

    expect(isGovNotFoundUrl("http://www.mof.gov.cn/404.htm")).toBe(true);
    expect(isGovNotFoundUrl("https://www.mof.gov.cn/404.html")).toBe(true);
    expect(isGovNotFoundUrl("https://www.mof.gov.cn/404")).toBe(true);
    expect(isGovNotFoundUrl("https://www.mof.gov.cn/path/notfound")).toBe(true);
    expect(isGovNotFoundUrl("https://www.mof.gov.cn/path/not-found.html")).toBe(true);
    expect(isGovNotFoundUrl("https://www.mof.gov.cn/art/40412.html")).toBe(false);
    expect(isGovNotFoundUrl("https://www.mof.gov.cn/zhengce/2024/notice.html")).toBe(false);
  });

  it("treats a not-found phrase as the page only when little else is present", () => {
    expect(notFoundPhraseDominates("页面不存在")).toBe(true);
    expect(notFoundPhraseDominates(`页面不存在${"甲".repeat(80)}`)).toBe(true);
    expect(notFoundPhraseDominates(`页面不存在${"甲".repeat(81)}`)).toBe(false);
    expect(notFoundPhraseDominates("404 Not Found")).toBe(true);
    expect(notFoundPhraseDominates("会议定于明日召开。")).toBe(false);
    expect(notFoundPhraseDominates("甘肃财政 通知公告 政务公开")).toBe(false);
    expect(notFoundPhraseDominates(`${"本页讨论页面不存在的处理办法。".repeat(20)}${"正文".repeat(400)}`)).toBe(false);
  });

  it("rejects known shells and keeps real short notices", () => {
    expect(isGovEmptyShell(GOV, GOV, "页面不存在", "")).toBe(true);
    expect(isGovEmptyShell(GOV, "https://www.mof.gov.cn/404.htm", "站点导航".repeat(100), "财政部")).toBe(true);
    expect(isGovEmptyShell("https://kjs.mof.gov.cn/art/1.html", "http://www.mof.gov.cn/404.htm", "很长的正文".repeat(50))).toBe(true);
    expect(isGovEmptyShell(GOV, GOV, "返回首页", "页面不存在")).toBe(true);
    expect(isGovEmptyShell(GOV, GOV, "会议定于明日召开。", "会议通知")).toBe(false);
    expect(isGovEmptyShell(GOV, GOV, "甘肃财政 通知公告 政务公开", "甘肃财政厅")).toBe(false);
    expect(isGovEmptyShell(
      GOV,
      GOV,
      `${"本页讨论页面不存在的处理办法。".repeat(40)}${"正文".repeat(800)}`,
      "页面不存在",
    )).toBe(false);
    expect(isGovEmptyShell("https://www.mof.gov.cn/art/40412.html", "https://www.mof.gov.cn/art/40412.html", "会议定于明日召开。")).toBe(false);
    expect(isGovEmptyShell("https://evilgov.cn/404.htm", "https://evilgov.cn/404.htm", "页面不存在")).toBe(false);
    expect(isGovEmptyShell("https://mp.weixin.qq.com/s/abc", "https://mp.weixin.qq.com/s/abc", "wechat article")).toBe(false);
  });
});

describe("negative origin statuses", () => {
  it("remembers only 429, 403, 404, and 410", () => {
    expect([429, 403, 404, 410].every(isNegativeOriginStatus)).toBe(true);
    expect([400, 401, 412, 500, 502, 520, 524].some(isNegativeOriginStatus)).toBe(false);
  });
});
