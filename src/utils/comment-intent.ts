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

export type CommentIntentResult = {
  intent: CommentIntent;
  priorityLevel: PriorityLevel;
  finalScore: number;
  canCreateOrder: boolean;
  isPotentialBuyer: boolean;
  isQuestion: boolean;
  matchedReasons: string[];
};

function removeVietnameseAccents(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function normalizeComment(input: string) {
  return removeVietnameseAccents(input)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(normalizeComment(keyword)));
}

function matchKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => text.includes(normalizeComment(keyword)));
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
  "size",
  "sz",
  "màu",
  "mau",
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

export function analyzeLiveCommentIntent(commentText: string): CommentIntentResult {
  const originalText = String(commentText || "").trim();
  const text = normalizeComment(originalText);

  if (!text) {
    return {
      intent: "normal",
      priorityLevel: "normal",
      finalScore: 0,
      canCreateOrder: false,
      isPotentialBuyer: false,
      isQuestion: false,
      matchedReasons: [],
    };
  }

  const question = isQuestion(text);
  const matchedReasons: string[] = [];

  const spamMatches = matchKeywords(text, spamKeywords);
  if (spamMatches.length > 0) {
    return {
      intent: "spam",
      priorityLevel: "normal",
      finalScore: 0,
      canCreateOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: spamMatches.map((item) => `Spam: ${item}`),
    };
  }

  const buyMatches = matchKeywords(text, buyKeywords);
  const priceMatches = matchKeywords(text, priceKeywords);
  const stockMatches = matchKeywords(text, stockKeywords);
  const shippingMatches = matchKeywords(text, shippingKeywords);
  const productMatches = matchKeywords(text, productKeywords);
  const howToBuyMatches = matchKeywords(text, howToBuyKeywords);

  for (const item of buyMatches) matchedReasons.push(`Có ý định mua: ${item}`);
  for (const item of priceMatches) matchedReasons.push(`Hỏi giá/voucher: ${item}`);
  for (const item of stockMatches) matchedReasons.push(`Hỏi tồn kho: ${item}`);
  for (const item of shippingMatches) matchedReasons.push(`Hỏi vận chuyển: ${item}`);
  for (const item of productMatches) matchedReasons.push(`Hỏi sản phẩm: ${item}`);
  for (const item of howToBuyMatches) matchedReasons.push(`Hỏi cách mua: ${item}`);

  let intent: CommentIntent = "normal";
  let finalScore = 0;

  if (buyMatches.length > 0) {
    intent = "buy";
    finalScore += 90;
  }

  if (howToBuyMatches.length > 0) {
    intent = "ask_how_to_buy";
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

  if (question && intent === "normal") {
    intent = "ask_product";
    finalScore = Math.max(finalScore, 45);
    matchedReasons.push("Có dấu hiệu là câu hỏi của khách");
  }

  if (matchedReasons.length === 0) {
    return {
      intent: "normal",
      priorityLevel: "normal",
      finalScore: 0,
      canCreateOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: [],
    };
  }

  let priorityLevel: PriorityLevel = "normal";

  if (finalScore >= 85) {
    priorityLevel = "high";
  } else if (finalScore >= 60) {
    priorityLevel = "medium";
  } else if (finalScore >= 35) {
    priorityLevel = "low";
  }

  const canCreateOrder = intent === "buy";

  const isPotentialBuyer = [
    "buy",
    "ask_price",
    "ask_stock",
    "ask_shipping",
    "ask_product",
    "ask_how_to_buy",
  ].includes(intent);

  return {
    intent,
    priorityLevel,
    finalScore,
    canCreateOrder,
    isPotentialBuyer,
    isQuestion: question,
    matchedReasons,
  };
}