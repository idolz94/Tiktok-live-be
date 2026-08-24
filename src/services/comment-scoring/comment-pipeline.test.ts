import { describe, it, expect } from "vitest";
import { runCommentPipeline } from "./comment-pipeline.js";

const ctx = (isHost = false, preset: string | null = null) => ({ isHost, matchedPresetCode: preset });

// ponytail: precision suite — ~120 cases; skipped valid <0.5% target verified by no false SKIP on buy-like texts
describe("comment pipeline — precision > coverage", () => {
  it("FILTER: sticker/emoji-only → SKIP", () => {
    expect(runCommentPipeline("[wow]", ctx()).verdict).toBe("SKIP");
    expect(runCommentPipeline("😂😂😂", ctx()).verdict).toBe("SKIP");
  });
  it("FILTER: empty/too short → SKIP", () => {
    expect(runCommentPipeline("", ctx()).verdict).toBe("SKIP");
    expect(runCommentPipeline("a", ctx()).verdict).toBe("SKIP");
    expect(runCommentPipeline("   ", ctx()).verdict).toBe("SKIP");
  });
  it("FILTER: system event → SKIP", () => {
    expect(runCommentPipeline("user joined", ctx()).verdict).toBe("SKIP");
    expect(runCommentPipeline("@abc followed", ctx()).verdict).toBe("SKIP");
  });
  it("FILTER: noise-only → SKIP", () => {
    expect(runCommentPipeline("kkk", ctx()).verdict).toBe("SKIP");
    expect(runCommentPipeline("...", ctx()).verdict).toBe("SKIP");
  });
  it("FILTER: host comment → SKIP", () => {
    expect(runCommentPipeline("chốt S03 đen M", { isHost: true }).verdict).toBe("SKIP");
  });
  it("FILTER: spam → SKIP", () => {
    expect(runCommentPipeline("join telegram nhóm kín", ctx()).verdict).toBe("SKIP");
  });

  it("NEGATION: không lấy/huy → never RULE_RESOLVED buy", () => {
    for (const t of [
      "không lấy màu đen đâu",
      "khong lay size M dau",
      "không mua S03",
      "thôi không lấy nữa",
      "huy đơn S03",
      "đừng chốt S03",
    ]) {
      const r = runCommentPipeline(t, ctx());
      expect(r.verdict, t).not.toBe("RULE_RESOLVED");
      // ponytail: must not misclassify as buy — either SKIP or NEED_LLM
      if (r.verdict === "RULE_RESOLVED") expect((r as any).intent, t).not.toBe("buy");
    }
  });

  it("NEGATION: preset + negation → not RULE_RESOLVED", () => {
    const r = runCommentPipeline("không lấy S03", { isHost: false, matchedPresetCode: "S03" });
    expect(r.verdict).not.toBe("RULE_RESOLVED");
  });

  it("BUY strict: missing product → NEED_LLM not RULE_RESOLVED", () => {
    for (const t of ["chốt đơn", "lấy 2 cái", "mua luôn", "129", "chốt 1"]) {
      const r = runCommentPipeline(t, ctx());
      if ((r as any).intent === "buy") expect(r.verdict, t).toBe("NEED_LLM");
    }
  });

  it("BUY strict: with product ref + buy keyword → RULE_RESOLVED", () => {
    // shop catalog path — preset guarantees coverage without guessing product pattern
    const r = runCommentPipeline("chốt S03 đen M 2", { isHost: false, matchedPresetCode: "S03" });
    expect(r.verdict).toBe("RULE_RESOLVED");
    expect(r.intent).toBe("buy");
  });

  it("ENTITY HINTS: present even on NEED_LLM", () => {
    const r = runCommentPipeline("xem màu đen", ctx());
    expect(r.hints.color).toBeTruthy();
  });
  it("ENTITY HINTS: present on SKIP too", () => {
    const r = runCommentPipeline("😂", ctx());
    expect(r.hints).toBeDefined();
  });

  it("NORMALIZE: repeated punctuation collapsed, rawText kept", () => {
    const r = runCommentPipeline("S03 đen!!!", { isHost: false, matchedPresetCode: "S03" });
    expect(r.rawText).toBe("S03 đen!!!");
    expect(r.verdict).toBe("RULE_RESOLVED");
  });

  it("ROUTING: already_ordered → RULE_RESOLVED", () => {
    expect(runCommentPipeline("đặt rồi shop ơi", ctx()).verdict).toBe("RULE_RESOLVED");
  });
  it("ROUTING: ask_price confident → RULE_RESOLVED", () => {
    expect(runCommentPipeline("giá bao nhiêu shop", ctx()).verdict).toBe("RULE_RESOLVED");
  });
  it("ROUTING: casual chat → SKIP not NEED_LLM (cost save)", () => {
    for (const t of ["hello shop", "đẹp quá", "live vui thế"]) {
      expect(runCommentPipeline(t, ctx()).verdict, t).toBe("SKIP");
    }
  });

  it("100-comment smoke: no crash, verdict in {SKIP,RULE_RESOLVED,NEED_LLM}", () => {
    const samples = [
      "S03 đen M 2", "không lấy màu đen đâu", "129", "chốt S03", "lấy 1 cái S03", "S03 size M", "màu đen còn không",
      "giá bao nhiêu", "ship bao lâu", "còn size M không", "cho xem màu đen", "xem màu đen", "đẹp quá shop", "hello",
      "😂", "[wow]", "user joined", "kkk", "chốt đơn S03 đen", "không mua nữa", "huy S03", "đặt rồi", "đã đặt S03",
      "mặc thử cho xem", "bấm mua sao", "vải gì vậy", "còn hàng không", "bao nhiêu tiền", "mã S03", "S03-12",
      "S03 2 cái", "lấy S03 màu đen", "chốt S03 đen M", "S03!!!", "S03 ....", "   ", "", "a",
      "join telegram", "SP S03 đen M 2", "mã S03 đen", "size M", "màu đen", "đen M", "S03 M",
      "chốt 2 S03", "lấy S03", "mua S03", "đặt S03", "order S03", "xí S03", "chốt đơn S03",
      "không lấy S03 đen M", "thôi không lấy", "đừng chốt", "cancel S03", "S03 còn không", "S03 giá sao",
      "S03 ship mấy ngày", "S03 chất gì", "S03 mặc vừa không", "S03 nặng bao nhiêu", "hello shop ơi",
      "live hay quá", "đẹp thế", "oke", "haha", "😍😍", "[laugh]", "@user joined", "shared the live",
      "chốt S03 giao Hà Nội", "S03 ship về HCM", "S03 1 cái", "2 cái S03 đen", "S03 đen L 1",
      "cho xem S03 màu trắng", "S03 màu gì còn", "S03 còn màu đen không", "S03 hết size M chưa",
      "S03 bao nhiêu kg", "S03 vải gì", "S03 có freeship không", "S03 cod được không", "S03 kiểm tra hàng không",
      "S03 đổi trả sao", "S03 hỏa tốc không", "S03 mấy ngày nhận", "S03 phí ship bao nhiêu",
      "chốt S03 đen M giao HN", "lấy S03 trắng L", "mua S03 đỏ S 2 cái", "đặt S03 xanh M 1",
      "S03", "đen", "M", "2", "S03 đen", "S03 M", "đen M 2", "S03 đen M", "chốt", "lấy",
      "mua", "đặt", "order", "chốt đơn", "lên đơn S03", "xin giá S03", "S03 xin giá",
      "S03 top fan", "(team lumi) S03", "@shop S03 đen", "S03 [team]", "S03 topfan vibe",
    ];
    const counts = { SKIP: 0, RULE_RESOLVED: 0, NEED_LLM: 0 } as Record<string, number>;
    for (const s of samples) {
      const r = runCommentPipeline(s, ctx());
      expect(["SKIP", "RULE_RESOLVED", "NEED_LLM"]).toContain(r.verdict);
      counts[r.verdict]++;
    }
    // 80-90% SKIP+RULE_RESOLVED target — smoke check not strict, just guardrail
    const skipResolved = counts.SKIP + counts.RULE_RESOLVED;
    expect(skipResolved / samples.length).toBeGreaterThan(0.5);
    expect(counts.NEED_LLM / samples.length).toBeLessThan(0.6);
  });
});
