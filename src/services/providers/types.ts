export type ShippingProviderCode = "ghtk" | "manual";

export type ShippingFeeResult = {
  providerCode: ShippingProviderCode;
  fee: number;
  insuranceFee?: number;
  delivery?: boolean;
  extFees?: Array<{ title: string; amount: number; type: string }>;
  raw?: unknown;
};

export type ShippingSubmitResult = {
  providerCode: ShippingProviderCode;
  trackingLabel: string;
  trackingCode?: string | null;
  externalOrderId?: string | null;
  fee?: number | null;
  insuranceFee?: number | null;
  estimatedPickTime?: string | null;
  estimatedDeliverTime?: string | null;
  statusCode?: string | null;
  status?: string;
  statusRaw?: string | null;
  labelUrl?: string | null;
  labelFormat?: string | null;
  labelPaperSize?: string | null;
  paymentSide?: 0 | 1 | null;
  rawResponse?: unknown;
};

export type ShippingTrackingResult = {
  providerCode: ShippingProviderCode;
  trackingCode?: string | null;
  status?: string;
  statusCode?: string | null;
  statusText?: string | null;
  message?: string | null;
  raw?: unknown;
};

export type ShippingCancelResult = {
  providerCode: ShippingProviderCode;
  logId?: string | null;
  status?: string;
  raw?: unknown;
};

export type ShippingWebhookStatusResult = {
  providerCode: ShippingProviderCode;
  shippingStatus: string;
  statusCode?: string | null;
  statusRaw?: string | null;
};

export type ShippingProviderAdapter = {
  code: ShippingProviderCode;
  getFee: (params: ShippingFeeParams) => Promise<ShippingFeeResult>;
  submit: (params: ShippingSubmitParams) => Promise<ShippingSubmitResult>;
  tracking: (params: ShippingTrackingParams) => Promise<ShippingTrackingResult>;
  cancel: (params: ShippingCancelParams) => Promise<ShippingCancelResult>;
  normalizeWebhookStatus?: (params: ShippingWebhookStatusParams) => ShippingWebhookStatusResult;
};

export type ShippingFeeParams = {
  shopId: string;
  orderId: string;
  pickProvince: string;
  pickDistrict: string;
  pickWard?: string;
  pickAddress?: string;
  receiverProvince: string;
  receiverDistrict: string;
  receiverWard?: string;
  receiverAddress?: string;
  weight?: number;
  transport?: "road" | "fly";
};

export type ShippingSubmitParams = {
  shopId: string;
  orderId: string;
  pickName: string;
  pickAddress: string;
  pickProvince: string;
  pickDistrict: string;
  pickWard?: string;
  pickTel: string;
  receiverName: string;
  receiverAddress: string;
  receiverProvince: string;
  receiverDistrict: string;
  receiverWard: string;
  receiverHamlet?: string;
  receiverTel: string;
  note?: string;
  isFreeShip?: 0 | 1;
  transport?: "road" | "fly";
  pickOption?: "cod" | "post";
};

export type ShippingTrackingParams = {
  shopId: string;
  orderId: string;
};

export type ShippingCancelParams = {
  shopId: string;
  orderId: string;
  trackingId?: string | null;
};

export type ShippingWebhookStatusParams = {
  statusId: number;
  fee?: number | null;
  pickMoney?: number | null;
  reasonCode?: string | null;
  reason?: string | null;
};
