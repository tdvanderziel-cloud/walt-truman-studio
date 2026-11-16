import { test } from "node:test";
import assert from "node:assert/strict";
import { accountFromUrl, detectPlatform, isIsoDate, normalizeAccount, slugify, ytdlpDateToIso } from "../server/source.ts";
import { explainYtdlpError } from "../server/fetch-video.ts";

test("detectPlatform", () => {
  assert.equal(detectPlatform("https://www.tiktok.com/@nos/video/123"), "tiktok");
  assert.equal(detectPlatform("https://vm.tiktok.com/ZMabc/"), "tiktok");
  assert.equal(detectPlatform("https://www.instagram.com/reel/Cxyz/"), "instagram");
  assert.equal(detectPlatform("https://youtube.com/shorts/abc"), "youtube");
  assert.equal(detectPlatform("https://youtu.be/abc"), "youtube");
  assert.equal(detectPlatform("https://x.com/user/status/1"), "x");
  assert.equal(detectPlatform("https://twitter.com/user/status/1"), "x");
  assert.equal(detectPlatform("https://notyoutube.com/x"), "other");
  assert.equal(detectPlatform("geen link"), "other");
});

test("accountFromUrl", () => {
  assert.equal(accountFromUrl("https://www.tiktok.com/@nos/video/123"), "@nos");
  assert.equal(accountFromUrl("https://x.com/somebody/status/99"), "@somebody");
  assert.equal(accountFromUrl("https://www.youtube.com/@kanaal/shorts"), "@kanaal");
  assert.equal(accountFromUrl("https://www.instagram.com/reel/Cxyz/"), "");
});

test("normalizeAccount", () => {
  assert.equal(normalizeAccount("nos"), "@nos");
  assert.equal(normalizeAccount("@@nos "), "@nos");
  assert.equal(normalizeAccount("NOS Jeugdjournaal"), "NOS Jeugdjournaal");
  assert.equal(normalizeAccount(""), "");
  assert.equal(normalizeAccount(undefined), "");
});

test("dates", () => {
  assert.equal(ytdlpDateToIso("20261103"), "2026-11-03");
  assert.equal(ytdlpDateToIso("2026-11-03"), "");
  assert.ok(isIsoDate("2026-02-28"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("03-11-2026"));
});

test("slugify", () => {
  assert.equal(slugify("@Café Ünïcode — test!"), "cafe-unicode-test");
  assert.equal(slugify("!!!"), "video");
  assert.ok(slugify("a".repeat(100)).length <= 40);
});

test("explainYtdlpError", () => {
  assert.match(explainYtdlpError("", true), /niet geïnstalleerd/);
  assert.match(explainYtdlpError("ERROR: This video is private", false), /privé/);
  assert.match(explainYtdlpError("ERROR: Unsupported URL", false), /niet herkend/);
  assert.match(explainYtdlpError("Unable to connect to proxy", false), /Geen verbinding/);
});
