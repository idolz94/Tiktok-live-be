UPDATE order_shipments
SET payment_side = CASE
  WHEN payment_side IN ('0', 'receiver', 'recipient', 'recipient_pays', 'receiver_pays') THEN '0'
  WHEN payment_side IN ('1', 'sender', 'shop', 'sender_pays', 'shop_pays', 'free_ship') THEN '1'
  ELSE '0'
END
WHERE payment_side IS NULL
   OR payment_side NOT IN ('0', '1');
