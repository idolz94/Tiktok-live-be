// ponytail: stage CLASSIFY — từ text đã normalize → intent + baseScore + matchedReasons.
// Không cộng bonus, không tính priority ở đây (đó là việc của stage SCORE).
//
// Thiết kế: bảng INTENT_SIGNALS thay cho chuỗi if/else cũ. Mỗi signal = 1 nhóm keyword +
// intent nó đại diện + thứ tự ưu tiên. Khi 1 câu match nhiều nhóm, nhóm có `priority` nhỏ
// nhất thắng. Thứ tự PHẦN TỬ trong bảng = thứ tự hiển thị matchedReasons (giữ nguyên như cũ
// để UI/log không đổi); `priority` mới là thứ tự quyết định intent.

import type { CommentIntent, IntentClassification } from "./comment-types.js";
import { INTENT_BASE_SCORE, WEAK_PRODUCT_BASE_SCORE } from "./comment-config.js";
import {
  alreadyOrderedKeywords,
  buyKeywords,
  howToBuyKeywords,
  priceKeywords,
  productDemoKeywords,
  productKeywords,
  shippingKeywords,
  spamKeywords,
  stockKeywords,
  undecidedKeywords,
  weakProductKeywords,
} from "./comment-keywords.js";
import { matchKeywords } from "./comment-extract.js";

type SignalKey =
  | "buy"
  | "already_ordered"
  | "product_demo"
  | "price"
  | "stock"
  | "shipping"
  | "product"
  | "weak_product"
  | "model_number"
  | "undecided"
  | "how_to_buy";

type IntentSignal = {
  key: SignalKey;
  intent: CommentIntent;
  baseScore: number;
  /** nhỏ hơn = ưu tiên cao hơn khi nhiều nhóm cùng match */
  priority: number;
  /** prefix trong matchedReasons, vd "Có ý định mua: chốt" */
  reasonLabel: string;
  match: (text: string) => string[];
};

// "mẫu" và "màu" đều thành "mau" sau khi bỏ dấu — nhưng "mau <số>" (mẫu 3) gần như chắc chắn là
// hỏi mẫu sản phẩm, không phải màu. Tách thành 1 signal riêng để bắt case này.
const MODEL_NUMBER_RE = /\bmau\s*#?\s*\d{1,4}\b/;

const byKeywords = (keywords: string[]) => (text: string) => matchKeywords(text, keywords);

export const INTENT_SIGNALS: readonly IntentSignal[] = [
  { key: "buy", intent: "buy", baseScore: INTENT_BASE_SCORE.buy, priority: 2, reasonLabel: "Có ý định mua", match: byKeywords(buyKeywords) },
  { key: "already_ordered", intent: "already_ordered", baseScore: INTENT_BASE_SCORE.already_ordered, priority: 1, reasonLabel: "Đã đặt/mua rồi", match: byKeywords(alreadyOrderedKeywords) },
  { key: "product_demo", intent: "ask_product_demo", baseScore: INTENT_BASE_SCORE.ask_product_demo, priority: 3, reasonLabel: "Yêu cầu demo sản phẩm", match: byKeywords(productDemoKeywords) },
  { key: "price", intent: "ask_price", baseScore: INTENT_BASE_SCORE.ask_price, priority: 6, reasonLabel: "Hỏi giá/voucher", match: byKeywords(priceKeywords) },
  { key: "stock", intent: "ask_stock", baseScore: INTENT_BASE_SCORE.ask_stock, priority: 7, reasonLabel: "Hỏi tồn kho", match: byKeywords(stockKeywords) },
  { key: "shipping", intent: "ask_shipping", baseScore: INTENT_BASE_SCORE.ask_shipping, priority: 8, reasonLabel: "Hỏi vận chuyển", match: byKeywords(shippingKeywords) },
  { key: "product", intent: "ask_product", baseScore: INTENT_BASE_SCORE.ask_product, priority: 9, reasonLabel: "Hỏi sản phẩm", match: byKeywords(productKeywords) },
  { key: "weak_product", intent: "ask_product", baseScore: WEAK_PRODUCT_BASE_SCORE, priority: 10, reasonLabel: "Tín hiệu sản phẩm yếu", match: byKeywords(weakProductKeywords) },
  { key: "model_number", intent: "ask_product", baseScore: INTENT_BASE_SCORE.ask_product, priority: 9, reasonLabel: "Hỏi sản phẩm", match: (t) => (MODEL_NUMBER_RE.test(t) ? ["mẫu (số)"] : []) },
  { key: "undecided", intent: "undecided", baseScore: INTENT_BASE_SCORE.undecided, priority: 5, reasonLabel: "Đang phân vân", match: byKeywords(undecidedKeywords) },
  { key: "how_to_buy", intent: "ask_how_to_buy", baseScore: INTENT_BASE_SCORE.ask_how_to_buy, priority: 4, reasonLabel: "Hỏi cách mua", match: byKeywords(howToBuyKeywords) },
];

export function matchSpam(text: string): string[] {
  return matchKeywords(text, spamKeywords);
}

/**
 * Phân loại intent cho text ĐÃ normalize (bỏ dấu, lowercase). Không xử lý spam — caller
 * check `matchSpam` trước vì spam short-circuit toàn bộ pipeline.
 */
export function classifyIntent(text: string): IntentClassification {
  const matchedReasons: string[] = [];
  let winner: IntentSignal | null = null;
  let hasProductKeyword = false;
  let hasWeakProductKeyword = false;
  let hasUndecidedKeyword = false;

  for (const signal of INTENT_SIGNALS) {
    const matches = signal.match(text);
    if (matches.length === 0) continue;

    for (const item of matches) matchedReasons.push(`${signal.reasonLabel}: ${item}`);
    if (signal.key === "product") hasProductKeyword = true;
    if (signal.key === "weak_product") hasWeakProductKeyword = true;
    if (signal.key === "undecided") hasUndecidedKeyword = true;
    if (!winner || signal.priority < winner.priority) winner = signal;
  }

  return {
    intent: winner?.intent ?? "normal",
    baseScore: winner?.baseScore ?? 0,
    matchedReasons,
    hasProductKeyword,
    hasWeakProductKeyword,
    hasUndecidedKeyword,
  };
}
