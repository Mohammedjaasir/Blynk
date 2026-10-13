/** Demo prices are the reference video's own rupee amounts: "₹99", "₹1,299". */
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
