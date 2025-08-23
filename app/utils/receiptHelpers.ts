// Format receipt text output for thermal printer
export function formatReceipt(order: any) {
  const lines = [
    "ZM Store POS",
    "=====================",
    `Receipt: ${order.receiptNo}`,
    `Date: ${new Date(order.paidAt).toLocaleString()}`,
    "",
  ];

  for (const item of order.items) {
    lines.push(`${item.qty}x ${item.productName}`);
    lines.push(`  @ ${item.unitPrice}  →  ${item.lineTotal}`);
  }

  lines.push("---------------------");
  lines.push(`TOTAL: ${order.grandTotal}`);
  lines.push("=====================");
  lines.push("Thank you!");
  return lines.join("\n");
}
