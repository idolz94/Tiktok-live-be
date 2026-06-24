const SPX_MESSAGES: Record<number, string> = {
  10001: "Kiện hàng vượt quá 17kg, vui lòng kiểm tra lại.",
  10013: "Cần chọn khung giờ lấy hàng trước khi tạo đơn.",
  10040: "Khung giờ lấy hàng đã hết hạn, vui lòng chọn lại.",
  10041: "Khối lượng kiện hàng không hợp lệ.",
  10042: "Địa chỉ không hợp lệ, vui lòng kiểm tra lại.",
  12051: "Thông tin SPX của shop không hợp lệ, vui lòng kiểm tra cài đặt.",
  13101: "Không thể tạo đơn SPX, vui lòng thử lại.",
  13103: "Đơn hàng đã được tạo trước đó trên SPX.",
  99001: "Lỗi tạm thời từ SPX, vui lòng thử lại.",
  99002: "Lỗi tạm thời từ SPX, vui lòng thử lại.",
  99003: "Lỗi tạm thời từ SPX, vui lòng thử lại.",
  99004: "Lỗi tạm thời từ SPX, vui lòng thử lại.",
};

export function getSpxErrorMessage(errorCode: number | undefined, fallback: string): string {
  if (errorCode !== undefined && SPX_MESSAGES[errorCode]) return SPX_MESSAGES[errorCode];
  return fallback || "Lỗi từ SPX, vui lòng thử lại.";
}
