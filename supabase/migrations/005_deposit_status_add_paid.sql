-- Thêm giá trị "paid" vào enum deposit_status nếu chưa có
-- Postgres không có ALTER TYPE ... ADD VALUE IF NOT EXISTS trước 14.x
-- dùng cách an toàn: check trước rồi mới add
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'deposit_status'
      AND e.enumlabel = 'paid'
  ) THEN
    ALTER TYPE deposit_status ADD VALUE 'paid';
  END IF;
END $$;
