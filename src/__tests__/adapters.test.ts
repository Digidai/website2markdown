import { describe, it, expect } from "vitest";
import { getAdapter, alwaysNeedsBrowser } from "../browser";
import { feishuAdapter } from "../browser/adapters/feishu";
import { wechatAdapter } from "../browser/adapters/wechat";
import { zhihuAdapter } from "../browser/adapters/zhihu";
import { yuqueAdapter } from "../browser/adapters/yuque";
import { notionAdapter } from "../browser/adapters/notion";
import { juejinAdapter } from "../browser/adapters/juejin";
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
});
