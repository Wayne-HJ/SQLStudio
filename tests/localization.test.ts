import assert from "node:assert/strict";
import test from "node:test";
import { englishMessages } from "../shared/messages.js";
import { normalizeLanguage, translate } from "../shared/localization.js";

test("language preferences accept English and default safely to Chinese", () => {
  assert.equal(normalizeLanguage("en"), "en");
  for (const value of ["zh-CN", "fr", null, undefined, {}, "__proto__"])
    assert.equal(normalizeLanguage(value), "zh-CN");
});
test("interface messages interpolate values without translating identifiers", () => {
  assert.equal(
    translate("en", "删除 {0}？", ["用户  数据"]),
    "Delete 用户  数据?",
  );
  assert.equal(
    translate("zh-CN", "删除 {0}？", ["用户  数据"]),
    "删除 用户  数据？",
  );
  assert.equal(
    translate("en", "已导出 SQL · {0} 个表 · {1} 条记录", [7, 432]),
    "SQL exported · 7 tables · 432 records",
  );
});
test("already formatted backend errors switch in both directions", () => {
  const source = "筛选列不存在：用户  状态";
  const english = translate("en", source);
  assert.equal(english, "Filter column does not exist: 用户  状态");
  assert.equal(translate("zh-CN", english), source);
  assert.equal(
    translate("zh-CN", translate("en", "请输入筛选值")),
    "请输入筛选值",
  );
});
test("message patterns treat punctuation literally and preserve unknown errors", () => {
  const source = "首版 SQL 导出每表上限 10,000 行：archive_2026 超出限制";
  assert.equal(
    translate("en", source),
    "SQL export is limited to 10,000 rows per table: archive_2026 exceeds the limit",
  );
  for (const message of [
    "ECONNREFUSED 127.0.0.1:3306",
    "SELECT '中文' AS name;",
    "toString",
    "__proto__",
  ])
    assert.equal(translate("en", message), message);
});
test("every translation preserves all interpolation tokens", () => {
  const tokens = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
  for (const [source, english] of Object.entries(englishMessages)) {
    assert.ok(english.trim(), source);
    assert.deepEqual(tokens(english), tokens(source), source);
  }
});
