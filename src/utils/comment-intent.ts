export type CommentIntent =
  | "buy"
  | "ask_price"
  | "ask_stock"
  | "ask_shipping"
  | "ask_product"
  | "ask_how_to_buy"
  | "normal"
  | "spam"
  | "user";

export type PriorityLevel = "high" | "medium" | "low" | "normal";

export type CommentRuleResult = {
  intent: CommentIntent;
  priorityLevel: PriorityLevel;
  finalScore: number;
  canSuggestOrder: boolean;
  canCreateDraftOrder: boolean;
  isPotentialBuyer: boolean;
  isQuestion: boolean;
  matchedReasons: string[];
};

export type CommentIntentResult = CommentRuleResult & {
  /** Legacy DB field. Keep mapped from canCreateDraftOrder until schema catches up. */
  canCreateOrder: boolean;
};

function removeVietnameseAccents(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function normalizeComment(input: string) {
  return removeVietnameseAccents(input)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(text: string, keyword: string) {
  const normalizedKeyword = normalizeComment(keyword);
  if (normalizedKeyword.length <= 2) {
    return new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}($|\\s)`).test(text);
  }

  return text.includes(normalizedKeyword);
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => hasKeyword(text, keyword));
}

function matchKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => hasKeyword(text, keyword));
}

const buyKeywords = [
  "chốt",
  "chot",
  "mua",
  "lấy",
  "lay",
  "order",
  "đặt",
  "dat",
  "xí",
  "xi",
  "xin giá",
  "xin gia",
  "lên đơn",
  "len don",
  "chốt đơn",
  "chot don",
  "lấy 1",
  "lay 1",
  "lấy 2",
  "lay 2",
  "mua 1",
  "mua 2",
];

const priceKeywords = [
  "bao nhiêu",
  "bao nhieu",
  "bn",
  "giá",
  "gia",
  "nhiêu tiền",
  "nhieu tien",
  "mấy tiền",
  "may tien",
  "bao tiền",
  "bao tien",
  "giá sao",
  "gia sao",
  "giá nhiêu",
  "gia nhieu",
  "giá bao nhiêu",
  "gia bao nhieu",
  "có mã giảm",
  "co ma giam",
  "voucher",
  "giảm không",
  "giam khong",
];

const stockKeywords = [
  "còn không",
  "con khong",
  "còn ko",
  "con ko",
  "còn hàng",
  "con hang",
  "còn size",
  "con size",
  "còn màu",
  "con mau",
  "còn mã",
  "con ma",
  "hết chưa",
  "het chua",
];

const shippingKeywords = [
  "ship",
  "giao",
  "cod",
  "phí ship",
  "phi ship",
  "vận chuyển",
  "van chuyen",
  "miễn ship",
  "mien ship",
  "giao hàng",
  "giao hang",
  "mấy ngày nhận",
  "may ngay nhan",
  "bao lâu nhận",
  "bao lau nhan",
  "hỏa tốc",
  "hoa toc",
  "trong ngày",
  "trong ngay",
  "kiểm tra hàng",
  "kiem tra hang",
  "đổi trả",
  "doi tra",
  "trả hàng",
  "tra hang",
  "không vừa",
  "khong vua",
  "bị lỗi",
  "bi loi",
];

const productKeywords = [
  "mã",
  "ma",
  "sản phẩm",
  "san pham",
  "kg",
  "cao",
  "nặng",
  "nang",
  "vừa không",
  "vua khong",
  "mặc vừa",
  "mac vua",
  "mặc size",
  "mac size",
  "tư vấn size",
  "tu van size",
  "chất",
  "chat",
  "vải",
  "vai",
  "xù",
  "xu",
  "mát không",
  "mat khong",
  "mua lẻ",
  "mua le",
  "bộ này",
  "bo nay",
  "da dầu",
  "da dau",
  "da khô",
  "da kho",
  "hỗn hợp",
  "hon hop",
  "dùng được cho da",
  "dung duoc cho da",
];

const weakProductKeywords = [
  "size",
  "sz",
  "màu",
  "mau",
  "trắng",
  "trang",
  "đen",
  "den",
  "đỏ",
  "do",
  "xanh",
];

const howToBuyKeywords = [
  "bấm mua",
  "bam mua",
  "mua thế nào",
  "mua the nao",
  "mua sao",
  "đặt thế nào",
  "dat the nao",
  "đặt hàng sao",
  "dat hang sao",
  "chốt sao",
  "chot sao",
  "làm sao mua",
  "lam sao mua",
  "mua ở đâu",
  "mua o dau",
];

const spamKeywords = [
  "telegram",
  "join telegram",
  "whatsapp",
  "zalo nhóm",
  "zalo nhom",
  "inbox riêng",
  "ib riêng",
];

const potentialBuyerIntents: CommentIntent[] = [
  "buy",
  "ask_price",
  "ask_stock",
  "ask_shipping",
  "ask_product",
  "ask_how_to_buy",
];

function isQuestion(text: string) {
  return (
    text.includes("?") ||
    includesAny(text, [
      "không",
      "khong",
      "ko",
      "bao nhiêu",
      "bao nhieu",
      "mấy",
      "may",
      "thế nào",
      "the nao",
      "được không",
      "duoc khong",
      "có được",
      "co duoc",
    ])
  );
}

function priorityFromScore(finalScore: number): PriorityLevel {
  if (finalScore >= 85) return "high";
  if (finalScore >= 60) return "medium";
  if (finalScore >= 35) return "low";
  return "normal";
}

function withLegacyOrderFlag(result: CommentRuleResult): CommentIntentResult {
  return {
    ...result,
    canCreateOrder: result.canCreateDraftOrder,
  };
}

export function analyzeLiveCommentIntent(commentText: string): CommentIntentResult {
  const originalText = String(commentText || "").trim();
  const text = normalizeComment(originalText);

  if (!text) {
    return withLegacyOrderFlag({
      intent: "normal",
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: false,
      matchedReasons: [],
    });
  }

  const question = isQuestion(text);

  const spamMatches = matchKeywords(text, spamKeywords);
  if (spamMatches.length > 0) {
    return withLegacyOrderFlag({
      intent: "spam",
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: spamMatches.map((item) => `Spam: ${item}`),
    });
  }

  const buyMatches = matchKeywords(text, buyKeywords);
  const priceMatches = matchKeywords(text, priceKeywords);
  const stockMatches = matchKeywords(text, stockKeywords);
  const shippingMatches = matchKeywords(text, shippingKeywords);
  const productMatches = matchKeywords(text, productKeywords);
  const weakProductMatches = matchKeywords(text, weakProductKeywords);
  const howToBuyMatches = matchKeywords(text, howToBuyKeywords);
  const matchedReasons: string[] = [];

  for (const item of buyMatches) matchedReasons.push(`Có ý định mua: ${item}`);
  for (const item of priceMatches) matchedReasons.push(`Hỏi giá/voucher: ${item}`);
  for (const item of stockMatches) matchedReasons.push(`Hỏi tồn kho: ${item}`);
  for (const item of shippingMatches) matchedReasons.push(`Hỏi vận chuyển: ${item}`);
  for (const item of productMatches) matchedReasons.push(`Hỏi sản phẩm: ${item}`);
  for (const item of weakProductMatches) matchedReasons.push(`Tín hiệu sản phẩm yếu: ${item}`);
  for (const item of howToBuyMatches) matchedReasons.push(`Hỏi cách mua: ${item}`);

  let intent: CommentIntent = "normal";
  let finalScore = 0;

  if (buyMatches.length > 0) {
    intent = "buy";
    finalScore = Math.max(finalScore, 90);
  }

  if (howToBuyMatches.length > 0) {
    intent = intent === "buy" ? intent : "ask_how_to_buy";
    finalScore = Math.max(finalScore, 85);
  }

  if (priceMatches.length > 0) {
    intent = intent === "buy" ? intent : "ask_price";
    finalScore = Math.max(finalScore, 75);
  }

  if (stockMatches.length > 0) {
    intent = intent === "buy" ? intent : "ask_stock";
    finalScore = Math.max(finalScore, 70);
  }

  if (shippingMatches.length > 0) {
    intent = intent === "buy" ? intent : "ask_shipping";
    finalScore = Math.max(finalScore, 65);
  }

  if (productMatches.length > 0) {
    intent = intent === "buy" ? intent : "ask_product";
    finalScore = Math.max(finalScore, 60);
  }

  if (weakProductMatches.length > 0) {
    intent = intent === "normal" ? "ask_product" : intent;
    // ponytail: color/size alone is useful for sorting, not enough for medium priority.
    finalScore = Math.max(finalScore, 30);
  }

  if (question && intent === "normal") {
    finalScore = Math.max(finalScore, 25);
    matchedReasons.push("Có dấu hiệu là câu hỏi của khách");
  }

  if (matchedReasons.length === 0) {
    return withLegacyOrderFlag({
      intent: "normal",
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: [],
    });
  }

  const canSuggestOrder = intent === "buy";
  // ponytail: product/variant/quantity validation lives in service, so base rules only suggest.
  const canCreateDraftOrder = false;

  return withLegacyOrderFlag({
    intent,
    priorityLevel: priorityFromScore(finalScore),
    finalScore,
    canSuggestOrder,
    canCreateDraftOrder,
    isPotentialBuyer: potentialBuyerIntents.includes(intent),
    isQuestion: question,
    matchedReasons,
  });
}
