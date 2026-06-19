import { ApiError } from "../../lib/api-error.js";
import type {
  ShippingCancelParams,
  ShippingCancelResult,
  ShippingFeeParams,
  ShippingFeeResult,
  ShippingProviderAdapter,
  ShippingSubmitParams,
  ShippingSubmitResult,
  ShippingTrackingParams,
  ShippingTrackingResult,
} from "./types.js";

export function createManualAdapter(): ShippingProviderAdapter {
  return {
    code: "manual",
    async getFee(_params: ShippingFeeParams): Promise<ShippingFeeResult> {
      return { providerCode: "manual", fee: 0, raw: { provider: "manual" } };
    },
    async submit(_params: ShippingSubmitParams): Promise<ShippingSubmitResult> {
      throw new ApiError(400, "Manual shipping is handled directly in the order service.", "MANUAL_SHIPPING_UNSUPPORTED");
    },
    async tracking(_params: ShippingTrackingParams): Promise<ShippingTrackingResult> {
      return { providerCode: "manual", status: "submitted", raw: { provider: "manual" } };
    },
    async cancel(_params: ShippingCancelParams): Promise<ShippingCancelResult> {
      return { providerCode: "manual", status: "cancelled", raw: { provider: "manual" } };
    },
  };
}
