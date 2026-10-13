export function formatLkr(n: number): string {
  const whole = Math.abs(n % 1) < 0.005;
  return 'LKR ' + n.toLocaleString('en-US', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
