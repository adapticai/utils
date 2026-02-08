/**
 * Legacy Alpaca Utility Functions
 * HTML content cleaning and price rounding helpers.
 */

/**
 * Round a price to the nearest 2 decimal places for Alpaca,
 * or 4 decimal places for prices less than $1.
 * @param price - The price to round
 * @returns The rounded price
 */
export const roundPriceForAlpaca = (price: number): number => {
  return price >= 1
    ? Math.round(price * 100) / 100
    : Math.round(price * 10000) / 10000;
};

/**
 * Cleans HTML content by removing tags, scripts, styles, and decoding entities.
 * @param htmlContent - The HTML string to clean
 * @returns The cleaned plain-text string
 */
export function cleanContent(htmlContent: string): string {
  // Remove <script> and <style> tags and their content
  let result = htmlContent.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove remaining HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // Remove unnecessary '+' characters
  result = result.replace(/\+\s*/g, ' ');

  // Replace named entities with plain text equivalents
  result = result.split('&nbsp;').join(' ')
    .split('&amp;').join('&')
    .split('&#8217;').join("'")
    .split('&#8216;').join("'")
    .split('&#8220;').join('"')
    .split('&#8221;').join('"')
    .split('&#39;').join("'");

  // Decode hexadecimal numeric entities (e.g., &#x1f92f;)
  result = result.replace(/&#x([\da-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  // Decode decimal numeric entities (e.g., &#8220; if not already replaced)
  result = result.replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)));

  // Normalize whitespace and trim
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}
