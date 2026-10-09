export function formatMoney(pence: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(pence / 100);
}
