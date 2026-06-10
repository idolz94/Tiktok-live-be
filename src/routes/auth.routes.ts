import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateOk } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// Clerk handle register/login hoàn toàn ở client.
// Backend chỉ cần logout để clear cookie.
router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (_request, response) => {
    response.clearCookie("__session");
    return mutateOk(response, "Đăng xuất thành công.", null);
  }),
);

export default router;
