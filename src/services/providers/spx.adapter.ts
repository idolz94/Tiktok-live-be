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

export function createSpxAdapter(): ShippingProviderAdapter {
  const unsupported = () => {
    throw new ApiError(400, "SPX shipping is not implemented yet.", "SPX_NOT_IMPLEMENTED");
  };

  return {
    code: "ghtk",
    async getFee(_params: ShippingFeeParams): Promise<ShippingFeeResult> {
      return unsupported();
    },
    async submit(_params: ShippingSubmitParams): Promise<ShippingSubmitResult> {
      return unsupported();
    },
    async tracking(_params: ShippingTrackingParams): Promise<ShippingTrackingResult> {
      return unsupported();
    },
    async cancel(_params: ShippingCancelParams): Promise<ShippingCancelResult> {
      return unsupported();
    },
  };
}
