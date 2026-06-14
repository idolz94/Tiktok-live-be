// GHTK error code → Vietnamese user-facing message
// Source: GHTK API documentation (error_code field in response)

const GHTK_ERROR_MESSAGES: Record<number, string> = {
  // System errors (101xx)
  10100: "Lỗi hệ thống GHTK. Vui lòng thử lại sau.",
  10101: "Lỗi kết nối hệ thống GHTK.",
  10102: "Dữ liệu đầu vào không hợp lệ.",
  10103: "Phương thức request không được hỗ trợ.",
  10104: "Lỗi xử lý dữ liệu phía GHTK.",
  10105: "Dịch vụ GHTK tạm thời không khả dụng.",

  // Auth errors (201xx)
  20100: "Token GHTK không hợp lệ hoặc đã hết hạn.",
  20101: "Tài khoản GHTK không có quyền thực hiện thao tác này.",
  20102: "API key GHTK sai hoặc chưa được cấu hình.",
  20103: "Phiên đăng nhập GHTK đã hết hạn.",

  // Create order errors (301xx)
  30100: "Không thể tạo đơn hàng GHTK.",
  30101: "Địa chỉ lấy hàng không hợp lệ.",
  30102: "Địa chỉ giao hàng không hợp lệ.",
  30103: "Số điện thoại người nhận không hợp lệ.",
  30104: "Tỉnh/thành phố giao hàng không được hỗ trợ.",
  30105: "Quận/huyện giao hàng không được hỗ trợ.",
  30106: "Phường/xã giao hàng không được hỗ trợ.",
  30107: "Mã đơn hàng đã tồn tại trong hệ thống GHTK.",
  30108: "Trọng lượng hàng không hợp lệ.",
  30109: "Giá trị COD vượt quá giới hạn cho phép.",
  30110: "Dịch vụ giao hàng không khả dụng cho khu vực này.",

  // Print errors (401xx)
  40100: "Không thể in vận đơn.",
  40101: "Mã vận đơn không tồn tại.",
  40102: "Đơn hàng chưa được xác nhận, không thể in.",

  // Cancel order errors (501xx)
  50101: "Không thể hủy đơn hàng này.",
  50102: "Đơn hàng không tồn tại trong hệ thống GHTK.",
  50103: "Đơn hàng đã được giao, không thể hủy.",
  50104: "Đơn hàng đang trong quá trình giao, không thể hủy.",
  50105: "Đơn hàng đã bị hủy trước đó.",
  50106: "Đơn hàng đang được lấy hàng, không thể hủy.",
  50107: "Bạn không có quyền hủy đơn hàng này.",
  50108: "Đơn hàng đã hoàn hàng, không thể hủy.",
  50109: "Lỗi hệ thống khi hủy đơn, vui lòng thử lại sau.",

  // Fee calculation errors (601xx)
  60100: "Không thể tính phí vận chuyển.",
  60101: "Địa chỉ không được hỗ trợ tính phí.",
  60102: "Dịch vụ không khả dụng cho tuyến đường này.",
};

const DEFAULT_ERROR = "Đã xảy ra lỗi từ GHTK. Vui lòng thử lại hoặc liên hệ hỗ trợ.";

export function getGhtkErrorMessage(errorCode: number | string | undefined): string {
  if (errorCode === undefined || errorCode === null) return DEFAULT_ERROR;
  const code = Number(errorCode);
  return GHTK_ERROR_MESSAGES[code] ?? DEFAULT_ERROR;
}
