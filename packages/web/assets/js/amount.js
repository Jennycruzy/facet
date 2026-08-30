export function parseTokenAmount(value, decimals = 18, symbol = "token") {
  const text = String(value).trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(text)) throw new Error(`Enter a valid ${symbol} amount.`);
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`${symbol} supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}
