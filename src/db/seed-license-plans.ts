import { db } from "../lib/db.js";
import { licensePlans } from "./schema/index.js";
import { sql } from "drizzle-orm";

const PLANS = [
  {
    code: "trial",
    name: "Dùng thử",
    description: "Trải nghiệm miễn phí 3 ngày, tối đa 200 đơn",
    priceMonthly: 0,
    maxOrdersPerMonth: 200,
    maxLiveSessionsPerMonth: null,
    maxMembers: 1,
    maxTiktokAccounts: 1,
    canPrint: true,
    canExportExcel: false,
    canUseReports: false,
    canUseShipping: true,
    status: "active",
    sortOrder: 0,
  },
  {
    code: "basic",
    name: "Basic",
    description: "1 tháng, tối đa 500 đơn/tháng",
    priceMonthly: 199000,
    maxOrdersPerMonth: 500,
    maxLiveSessionsPerMonth: null,
    maxMembers: 1,
    maxTiktokAccounts: 1,
    canPrint: true,
    canExportExcel: true,
    canUseReports: false,
    canUseShipping: true,
    status: "active",
    sortOrder: 1,
  },
  {
    code: "pro",
    name: "Pro",
    description: "3 tháng, tối đa 1500 đơn/tháng",
    priceMonthly: 183000,
    maxOrdersPerMonth: 1500,
    maxLiveSessionsPerMonth: null,
    maxMembers: 1,
    maxTiktokAccounts: 1,
    canPrint: true,
    canExportExcel: true,
    canUseReports: true,
    canUseShipping: true,
    status: "active",
    sortOrder: 2,
  },
  {
    code: "vip",
    name: "VIP",
    description: "6 tháng + 1 tháng miễn phí, không giới hạn đơn",
    priceMonthly: 170000,
    maxOrdersPerMonth: null,
    maxLiveSessionsPerMonth: null,
    maxMembers: 1,
    maxTiktokAccounts: 1,
    canPrint: true,
    canExportExcel: true,
    canUseReports: true,
    canUseShipping: true,
    status: "active",
    sortOrder: 3,
  },
] as const;

export async function seedLicensePlans() {
  for (const plan of PLANS) {
    await db
      .insert(licensePlans)
      .values(plan)
      .onConflictDoUpdate({
        target: licensePlans.code,
        set: {
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          maxOrdersPerMonth: plan.maxOrdersPerMonth ?? null,
          maxLiveSessionsPerMonth: plan.maxLiveSessionsPerMonth ?? null,
          maxMembers: plan.maxMembers ?? null,
          maxTiktokAccounts: plan.maxTiktokAccounts ?? null,
          canPrint: plan.canPrint,
          canExportExcel: plan.canExportExcel,
          canUseReports: plan.canUseReports,
          canUseShipping: plan.canUseShipping,
          status: plan.status,
          sortOrder: plan.sortOrder,
          updatedAt: sql`now()`,
        },
      });
  }
  console.log("✓ License plans seeded:", PLANS.map((p) => p.code).join(", "));
}
