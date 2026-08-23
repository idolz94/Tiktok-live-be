import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const codes = ["LUMI-627337", "LUMI-949317"];

for (const code of codes) {
  const orders = await sql`
    select id, order_code, status, subtotal_amount, total_amount, live_session_id, customer_id, created_at, updated_at
    from orders where order_code = ${code}
  `;
  const order = orders[0];
  console.log("=== ORDER", code, "===");
  console.log(order);
  if (order) {
    const items = await sql`
      select id, product_code, product_name, variant_name, color, size, quantity, price, raw_comment_text, created_at, updated_at
      from order_items where order_id = ${order.id}
    `;
    console.log("order_items count:", items.length);
    console.log(items);
  }
  console.log("");
}
