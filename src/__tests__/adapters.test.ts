import { describe, it, expect } from "vitest";
import { getAdapter, alwaysNeedsBrowser } from "../browser";
import { feishuAdapter } from "../browser/adapters/feishu";
import { wechatAdapter } from "../browser/adapters/wechat";
import { zhihuAdapter } from "../browser/adapters/zhihu";
import { yuqueAdapter } from "../browser/adapters/yuque";
import { notionAdapter } from "../browser/adapters/notion";
import { juejinAdapter } from "../browser/adapters/juejin";
import { csdnAdapter } from "../browser/adapters/csdn";
import { kr36Adapter } from "../browser/adapters/36kr";
import { toutiaoAdapter } from "../browser/adapters/toutiao";
import { neteaseAdapter } from "../browser/adapters/netease";
import { weiboAdapter } from "../browser/adapters/weibo";
import { redditAdapter } from "../browser/adapters/reddit";
import { twitterAdapter } from "../browser/adapters/twitter";
import { genericAdapter } from "../browser/adapters/generic";

describe("getAdapter", () => {
  it("matches Feishu URLs", () => {
    expect(getAdapter("https://acnha3rzu6s0.feishu.cn/wiki/abc")).toBe(feishuAdapter);
    expect(getAdapter("https://example.larksuite.com/docs/xyz")).toBe(feishuAdapter);
  });

  it("matches WeChat URLs", () => {
    expect(getAdapter("https://mp.weixin.qq.com/s/abc123")).toBe(wechatAdapter);
  });

  it("matches Zhihu URLs", () => {
    expect(getAdapter("https://zhuanlan.zhihu.com/p/12345")).toBe(zhihuAdapter);
    expect(getAdapter("https://zhihu.com/p/67890")).toBe(zhihuAdapter);
    expect(getAdapter("https://www.zhihu.com/question/12345")).toBe(zhihuAdapter);
  });

  it("matches Yuque URLs", () => {
    expect(getAdapter("https://www.yuque.com/user/doc")).toBe(yuqueAdapter);
  });

  it("matches Notion URLs", () => {
    expect(getAdapter("https://example.notion.site/Page-abc")).toBe(notionAdapter);
    expect(getAdapter("https://www.notion.so/workspace/page")).toBe(notionAdapter);
  });

  it("matches Juejin URLs", () => {
    expect(getAdapter("https://juejin.cn/post/12345")).toBe(juejinAdapter);
  });

  it("matches CSDN URLs", () => {
    expect(getAdapter("https://blog.csdn.net/user/article/details/123")).toBe(csdnAdapter);
    expect(getAdapter("https://www.csdn.net/article/456")).toBe(csdnAdapter);
  });

  it("matches 36kr URLs", () => {
    expect(getAdapter("https://36kr.com/p/12345")).toBe(kr36Adapter);
    expect(getAdapter("https://www.36kr.com/newsflashes/67890")).toBe(kr36Adapter);
  });

  it("matches Toutiao URLs", () => {
    expect(getAdapter("https://www.toutiao.com/article/12345")).toBe(toutiaoAdapter);
    expect(getAdapter("https://toutiao.com/a67890")).toBe(toutiaoAdapter);
  });

  it("matches NetEase URLs", () => {
    expect(getAdapter("https://www.163.com/dy/article/abc")).toBe(neteaseAdapter);
    expect(getAdapter("https://news.163.com/21/0101/00/abc.html")).toBe(neteaseAdapter);
  });

  it("matches Weibo URLs", () => {
    expect(getAdapter("https://weibo.com/1234567890/abc")).toBe(weiboAdapter);
    expect(getAdapter("https://www.weibo.com/ttarticle/p/show?id=123")).toBe(weiboAdapter);
  });

  it("matches Reddit URLs", () => {
    expect(getAdapter("https://www.reddit.com/r/programming/comments/abc/title")).toBe(redditAdapter);
    expect(getAdapter("https://old.reddit.com/r/technology/")).toBe(redditAdapter);
  });

  it("matches Twitter/X URLs", () => {
    expect(getAdapter("https://x.com/user/status/12345")).toBe(twitterAdapter);
    expect(getAdapter("https://twitter.com/user/status/67890")).toBe(twitterAdapter);
  });

  it("falls back to generic for unknown URLs", () => {
    expect(getAdapter("https://example.com")).toBe(genericAdapter);
    expect(getAdapter("https://blog.example.com/article")).toBe(genericAdapter);
  });
});

describe("alwaysNeedsBrowser", () => {
  it("returns true for Feishu", () => {
    expect(alwaysNeedsBrowser("https://x.feishu.cn/wiki/abc")).toBe(true);
  });

  it("returns true for WeChat", () => {
    expect(alwaysNeedsBrowser("https://mp.weixin.qq.com/s/abc")).toBe(true);
  });

  it("returns true for Yuque", () => {
    expect(alwaysNeedsBrowser("https://www.yuque.com/user/doc")).toBe(true);
  });

  it("returns true for Notion", () => {
    expect(alwaysNeedsBrowser("https://example.notion.site/Page")).toBe(true);
  });

  it("returns false for generic sites", () => {
    expect(alwaysNeedsBrowser("https://example.com")).toBe(false);
  });

  it("returns true for Zhihu", () => {
    expect(alwaysNeedsBrowser("https://zhuanlan.zhihu.com/p/123")).toBe(true);
  });

  it("returns true for Juejin", () => {
    expect(alwaysNeedsBrowser("https://juejin.cn/post/12345")).toBe(true);
  });

  it("returns true for CSDN", () => {
    expect(alwaysNeedsBrowser("https://blog.csdn.net/user/article/details/123")).toBe(true);
  });

  it("returns true for 36kr", () => {
    expect(alwaysNeedsBrowser("https://36kr.com/p/12345")).toBe(true);
  });

  it("returns true for Toutiao", () => {
    expect(alwaysNeedsBrowser("https://www.toutiao.com/article/12345")).toBe(true);
  });

  it("returns false for NetEase (static fetch works)", () => {
    expect(alwaysNeedsBrowser("https://www.163.com/dy/article/abc")).toBe(false);
  });

  it("returns true for Weibo", () => {
    expect(alwaysNeedsBrowser("https://weibo.com/1234567890/abc")).toBe(true);
  });

  it("returns false for Reddit (static fetch via old.reddit.com)", () => {
    expect(alwaysNeedsBrowser("https://www.reddit.com/r/programming/comments/abc/title")).toBe(false);
  });

  it("returns false for Twitter/X (direct API fetch)", () => {
    expect(alwaysNeedsBrowser("https://x.com/user/status/12345")).toBe(false);
    expect(alwaysNeedsBrowser("https://twitter.com/user/status/67890")).toBe(false);
  });
});
