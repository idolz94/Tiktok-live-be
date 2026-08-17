export type CommentIntent =
  | "buy"
  | "already_ordered"
  | "ask_price"
  | "ask_stock"
  | "ask_shipping"
  | "ask_product"
  | "ask_product_demo"
  | "ask_how_to_buy"
  | "normal"
  | "spam"
  | "user";

export type CommentTopic =
  | "size"
  | "color"
  | "material"
  | "weight"
  | "capacity"
  | "fee"
  | "delivery_time"
  | "size_variant"
  | "unknown";

export type PriorityLevel = "high" | "medium" | "low" | "normal";

export type ParsedCommentData = {
  productCode: string | null;
  color: string | null;
  size: string | null;
  quantity: number | null;
};

export type CommentRuleResult = {
  intent: CommentIntent;
  topic?: CommentTopic;
  confidence: number;
  priorityLevel: PriorityLevel;
  finalScore: number;
  canSuggestOrder: boolean;
  canCreateDraftOrder: boolean;
  isPotentialBuyer: boolean;
  isQuestion: boolean;
  matchedReasons: string[];
  productReference?: string;
  parsedData?: ParsedCommentData;
  missingFields?: string[];
  suggestedReply?: string;
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

// ponytail: "đã đặt rồi" — khách đã chốt, không gợi ý tạo đơn trùng
const alreadyOrderedKeywords = [
  "đặt rồi",
  "dat roi",
  "đã đặt",
  "da dat",
  "order rồi",
  "order roi",
  "đã order",
  "da order",
  "chốt rồi",
  "chot roi",
  "đã chốt",
  "da chot",
  "mua rồi",
  "mua roi",
  "đã mua",
  "da mua",
];

// ponytail: "mặc thử đi shop" — yêu cầu demo sản phẩm, tín hiệu mua rất cao
const productDemoKeywords = [
  "mặc thử",
  "mac thu",
  "mặc cho xem",
  "mac cho xem",
  "thử cho xem",
  "thu cho xem",
  "xoay xem",
  "xoay cho xem",
  "demo",
  "trên người",
  "tren nguoi",
  "lên người",
  "len nguoi",
  "mặc lên",
  "mac len",
];

// ponytail: topic keywords — xác định chủ đề câu hỏi để phân loại nhanh
const topicKeywords: Record<string, string[]> = {
  size: ["size", "sz", "cỡ", "vừa không", "vua khong", "mặc vừa", "mac vua", "tư vấn size", "tu van size", "mặc size", "mac size"],
  size_variant: ["còn size", "con size", "hết size", "het size", "size nào còn", "size nao con"],
  color: ["màu", "mau", "trắng", "trang", "đen", "den", "đỏ", "do", "xanh", "vàng", "vang", "hồng", "hong", "be", "nâu", "nau", "kem", "tím", "tim", "cam", "ghi", "xám", "xam"],
  material: ["chất", "chat", "vải", "vai", "xù", "xu", "mát không", "mat khong", "chất vải", "chat vai", "thun", "cotton", "lụa", "lua"],
  weight: ["nặng", "nang", "kg", "cân nặng", "can nang", "bao nhiêu kg", "bao nhieu kg"],
  capacity: ["dung tích", "dung tich", "chứa được", "chua duoc", "sức chứa", "suc chua"],
  fee: ["phí ship", "phi ship", "ship bao nhiêu", "ship bao nhieu", "miễn ship", "mien ship", "phí giao", "phi giao"],
  delivery_time: ["mấy ngày", "may ngay", "bao lâu", "bao lau", "khi nào nhận", "khi nao nhan", "hỏa tốc", "hoa toc", "trong ngày", "trong ngay"],
};

const potentialBuyerIntents: CommentIntent[] = [
  "buy",
  "ask_price",
  "ask_stock",
  "ask_shipping",
  "ask_product",
  "ask_product_demo",
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

// ponytail: strip TikTok badges/ranks/user @handles — noise that harms keyword matching
const META_NOISE_PATTERNS = [
  /\b(top fan|topfans|top fan vibe|fans|new engager|follower)\b/gi,
  /\b@\w+/g,
  /\[[^\]]+\]/g,
  /\(team|team lumi|official\)/gi,
];

function stripMetadataNoise(text: string) {
  return META_NOISE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, " "), text).replace(/\s+/g, " ").trim();
}

// ponytail: product reference extraction — position/location/direction mentioned in comment
const PRODUCT_REFERENCE_PATTERNS = [
  /(?:sp|mã|mã sản phẩm|product)\s*#?\s*([a-z0-9]+)/i,
  /(?:vị trí|vi tri|mục|muc|hàng|hang)\s*#?\s*(\d+)/i,
  /\b(stt|số thứ tự|so thu tu)\s*#?\s*(\d+)/i,
  /\b([a-z])\s*[-–]\s*(\d{1,3})\b/i,
];

function extractProductReference(text: string): string | undefined {
  for (const pattern of PRODUCT_REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return (match[2] || match[1] || "").trim();
  }
  return undefined;
}

// ponytail: topic detection — first matching topic wins, unknown fallback for short/ambiguous
function detectTopic(text: string, hasStrongSignal: boolean): CommentTopic {
  const orderedTopics: CommentTopic[] = [
    "size_variant",
    "size",
    "material",
    "capacity",
    "weight",
    "fee",
    "delivery_time",
    "color",
  ];
  for (const topic of orderedTopics) {
    const keywords = topicKeywords[topic];
    if (keywords && includesAny(text, keywords)) return topic;
  }
  // ponytail: short/ambiguous comments without strong intent → unknown topic
  if (!hasStrongSignal && text.split(/\s+/).length <= 4) return "unknown";
  return "unknown";
}

// ponytail: confidence scoring — density and specificity of matched signals
function scoreConfidence(
  matchedCount: number,
  hasMultipleKeywords: boolean,
  hasProductRef: boolean,
  textWordCount: number,
): number {
  if (matchedCount === 0) return 0.3;
  let base = 0.6;
  if (hasMultipleKeywords) base = 0.85;
  if (hasProductRef) base += 0.05;
  if (textWordCount <= 3) base -= 0.15;
  return Math.min(0.95, Math.max(0.25, base));
}

// ponytail: size extraction — S/M/L/XL family + "size M", "sz 42"
const SIZE_TOKEN_PATTERN = /\b(?:size\s+|sz\s+)?(xxl|xl|l|m|s|xs)\b(?:\s*(\d{1,3}))?/i;
const SIZE_PLAIN_PATTERN = /\b(size|sz|cỡ|co)\s*[:#]?\s*([a-z0-9]{1,4})\b/i;

function extractSize(text: string): string | null {
  const tokenMatch = text.match(SIZE_TOKEN_PATTERN);
  if (tokenMatch) {
    const size = tokenMatch[1].toUpperCase();
    return tokenMatch[2] ? `${size} ${tokenMatch[2]}` : size;
  }
  const plainMatch = text.match(SIZE_PLAIN_PATTERN);
  if (plainMatch) return plainMatch[2].toUpperCase();
  return null;
}

// ponytail: color extraction — reuse topicKeywords.color list, match words
const COLOR_PATTERN = /\b(trắng|trang|đen|den|đỏ|do|xanh|vàng|vang|hồng|hong|be|nâu|nau|kem|tím|tim|cam|ghi|xám|xam|màu|mau)\b/gi;

function extractColor(text: string): string | null {
  const matches = text.match(COLOR_PATTERN);
  if (!matches || matches.length === 0) return null;
  // ponytail: keep first color mention — multiple colors likely a question
  const first = matches[0].toLowerCase();
  // strip leading "màu/mau" prefix if present
  return first.replace(/^(màu|mau)\s*/, "").trim() || first;
}

// ponytail: quantity extraction — "2 cái", "3 chiếc", "lấy 1", "chốt 2"
const QUANTITY_UNIT_PATTERN = /(\d{1,3})\s*(?:cái|chiec|chiếc|bộ|bo|sp|san pham)?/i;
const QUANTITY_VERB_PATTERN = /(?:lấy|lay|chốt|chot|mua|đặt|dat|order)\s+(\d{1,3})\b/i;

function extractQuantity(text: string): number | null {
  const verbMatch = text.match(QUANTITY_VERB_PATTERN);
  if (verbMatch) {
    const n = parseInt(verbMatch[1], 10);
    if (n > 0 && n < 10000) return n;
  }
  const unitMatch = text.match(QUANTITY_UNIT_PATTERN);
  if (unitMatch) {
    const n = parseInt(unitMatch[1], 10);
    if (n > 0 && n < 10000) return n;
  }
  return null;
}

// ponytail: parse all fields from normalized comment text
function parseCommentData(text: string, productReference?: string): ParsedCommentData {
  return {
    productCode: productReference ?? null,
    color: extractColor(text),
    size: extractSize(text),
    quantity: extractQuantity(text),
  };
}

// ponytail: compute missing fields — product & quantity always checked; color/size only if mentioned-but-unspecified
function computeMissingFields(parsed: ParsedCommentData, intent: CommentIntent): string[] {
  const missing: string[] = [];
  if (intent !== "buy") return missing;
  if (!parsed.productCode) missing.push("product");
  if (!parsed.quantity) missing.push("quantity");
  return missing;
}

// ponytail: advisory reply suggestion for seller — explicit, no silent action
export function buildSuggestedReply(intent: CommentIntent, missingFields: string[]): string {
  if (intent !== "buy" || missingFields.length === 0) return "";
  const labels: Record<string, string> = {
    product: "mã sản phẩm",
    color: "màu",
    size: "size",
    quantity: "số lượng",
  };
  const parts = missingFields.map((f) => labels[f] || f).filter(Boolean);
  if (parts.length === 0) return "";
  return `Shop hỏi thêm: ${parts.join(", ")} để chốt đơn nhé ạ.`;
}

export function analyzeLiveCommentIntent(commentText: string): CommentIntentResult {
  const originalText = String(commentText || "").trim();
  const cleanedText = stripMetadataNoise(originalText);
  const text = normalizeComment(cleanedText);

  if (!text) {
    return withLegacyOrderFlag({
      intent: "normal",
      topic: "unknown",
      confidence: 0,
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: false,
      matchedReasons: [],
      parsedData: { productCode: null, color: null, size: null, quantity: null },
      missingFields: [],
      suggestedReply: "",
    });
  }

  const question = isQuestion(text);
  const productReference = extractProductReference(text);
  const textWordCount = text.split(/\s+/).filter(Boolean).length;

  const spamMatches = matchKeywords(text, spamKeywords);
  if (spamMatches.length > 0) {
    return withLegacyOrderFlag({
      intent: "spam",
      topic: "unknown",
      confidence: 0.95,
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: spamMatches.map((item) => `Spam: ${item}`),
      parsedData: { productCode: null, color: null, size: null, quantity: null },
      missingFields: [],
      suggestedReply: "",
    });
  }

  const buyMatches = matchKeywords(text, buyKeywords);
  const alreadyOrderedMatches = matchKeywords(text, alreadyOrderedKeywords);
  const productDemoMatches = matchKeywords(text, productDemoKeywords);
  const priceMatches = matchKeywords(text, priceKeywords);
  const stockMatches = matchKeywords(text, stockKeywords);
  const shippingMatches = matchKeywords(text, shippingKeywords);
  const productMatches = matchKeywords(text, productKeywords);
  const weakProductMatches = matchKeywords(text, weakProductKeywords);
  const howToBuyMatches = matchKeywords(text, howToBuyKeywords);
  const matchedReasons: string[] = [];

  for (const item of buyMatches) matchedReasons.push(`Có ý định mua: ${item}`);
  for (const item of alreadyOrderedMatches) matchedReasons.push(`Đã đặt/mua rồi: ${item}`);
  for (const item of productDemoMatches) matchedReasons.push(`Yêu cầu demo sản phẩm: ${item}`);
  for (const item of priceMatches) matchedReasons.push(`Hỏi giá/voucher: ${item}`);
  for (const item of stockMatches) matchedReasons.push(`Hỏi tồn kho: ${item}`);
  for (const item of shippingMatches) matchedReasons.push(`Hỏi vận chuyển: ${item}`);
  for (const item of productMatches) matchedReasons.push(`Hỏi sản phẩm: ${item}`);
  for (const item of weakProductMatches) matchedReasons.push(`Tín hiệu sản phẩm yếu: ${item}`);
  for (const item of howToBuyMatches) matchedReasons.push(`Hỏi cách mua: ${item}`);

  let intent: CommentIntent = "normal";
  let finalScore = 0;

  // ponytail: already_ordered must come BEFORE buy — "đặt rồi" contains "đặt"
  if (alreadyOrderedMatches.length > 0) {
    intent = "already_ordered";
    finalScore = Math.max(finalScore, 80);
  } else if (buyMatches.length > 0) {
    intent = "buy";
    finalScore = Math.max(finalScore, 90);
  }

  if (productDemoMatches.length > 0 && intent !== "buy" && intent !== "already_ordered") {
    intent = "ask_product_demo";
    finalScore = Math.max(finalScore, 88);
  }

  if (howToBuyMatches.length > 0 && intent === "normal") {
    intent = "ask_how_to_buy";
    finalScore = Math.max(finalScore, 85);
  }

  if (priceMatches.length > 0 && intent === "normal") {
    intent = "ask_price";
    finalScore = Math.max(finalScore, 75);
  }

  if (stockMatches.length > 0 && intent === "normal") {
    intent = "ask_stock";
    finalScore = Math.max(finalScore, 70);
  }

  if (shippingMatches.length > 0 && intent === "normal") {
    intent = "ask_shipping";
    finalScore = Math.max(finalScore, 65);
  }

  if (productMatches.length > 0 && intent === "normal") {
    intent = "ask_product";
    finalScore = Math.max(finalScore, 60);
  }

  if (weakProductMatches.length > 0 && intent === "normal") {
    intent = "ask_product";
    finalScore = Math.max(finalScore, 30);
  }

  const hasStrongSignal = finalScore >= 60;
  const topic = detectTopic(text, hasStrongSignal);
  const totalMatched = buyMatches.length + alreadyOrderedMatches.length +
    productDemoMatches.length + priceMatches.length + stockMatches.length +
    shippingMatches.length + productMatches.length + weakProductMatches.length +
    howToBuyMatches.length;
  const confidence = scoreConfidence(
    totalMatched,
    totalMatched >= 2,
    Boolean(productReference),
    textWordCount,
  );

  if (question && intent === "normal") {
    finalScore = Math.max(finalScore, 25);
    matchedReasons.push("Có dấu hiệu là câu hỏi của khách");
  }

  if (matchedReasons.length === 0) {
    return withLegacyOrderFlag({
      intent: "normal",
      topic,
      confidence,
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: [],
      productReference,
      parsedData: { productCode: null, color: null, size: null, quantity: null },
      missingFields: [],
      suggestedReply: "",
    });
  }

  // ponytail: parse structured data from comment for Phase 2 action UI
  const parsedData = parseCommentData(text, productReference);
  const missingFields = computeMissingFields(parsedData, intent);
  const suggestedReply = buildSuggestedReply(intent, missingFields);

  const canSuggestOrder = intent === "buy";
  // ponytail: Phase 2 — require product reference for draft order, prevents silent auto-creation
  const canCreateDraftOrder = intent === "buy" && Boolean(productReference);

  return withLegacyOrderFlag({
    intent,
    topic,
    confidence,
    priorityLevel: priorityFromScore(finalScore),
    finalScore,
    canSuggestOrder,
    canCreateDraftOrder,
    isPotentialBuyer: potentialBuyerIntents.includes(intent),
    isQuestion: question,
    matchedReasons,
    productReference,
    parsedData,
    missingFields,
    suggestedReply,
  });
}
