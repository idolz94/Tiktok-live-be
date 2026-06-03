export class ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown) {
  return new ApiError(400, message, "BAD_REQUEST", details);
}

export function unauthorized(message = "Vui lòng đăng nhập lại.") {
  return new ApiError(401, message, "UNAUTHORIZED");
}

export function forbidden(message = "Bạn không có quyền thực hiện thao tác này.") {
  return new ApiError(403, message, "FORBIDDEN");
}

export function notFound(message = "Không tìm thấy dữ liệu.") {
  return new ApiError(404, message, "NOT_FOUND");
}
