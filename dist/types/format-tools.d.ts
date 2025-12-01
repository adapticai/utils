/**
 * Capitalizes the first letter of a string
 * @param {string} str - The string to capitalize
 * @returns {string} The capitalized string, or original value if not a string
 * @example
 * capitalize('hello') // 'Hello'
 * capitalize(123) // 123
 */
export declare function capitalize(str: string): string;
/**
 * Transforms enum formatting to human readable format (e.g. 'STOCK_TICKER' to 'Stock Ticker')
 * @param {string} value - The enum string to format
 * @returns {string} The formatted string, or empty string if no value provided
 * @example
 * formatEnum('STOCK_TICKER') // 'Stock Ticker'
 */
export declare function formatEnum(value: string): string;
/**
 * Formats a number as US currency
 * @param {number} value - The number to format
 * @returns {string} The formatted currency string (e.g. '$1,234.56')
 * @example
 * formatCurrency(1234.56) // '$1,234.56'
 * formatCurrency(NaN) // '$0.00'
 */
export declare function formatCurrency(value: number): string;
/**
 * Formats a number with commas
 * @param {number} value - The number to format
 * @returns {string} The formatted number string (e.g. '1,234.56')
 * @example
 * formatNumber(1234.56) // '1,234.56'
 * formatNumber(NaN) // '0'
 */
export declare function formatNumber(value: number): string;
/**
 * Formats a number as a percentage
 * @param {number} value - The number to format (e.g. 0.75 for 75%)
 * @param {number} [decimalPlaces=2] - Number of decimal places to show
 * @returns {string} The formatted percentage string (e.g. '75.00%')
 * @example
 * formatPercentage(0.75) // '75.00%'
 * formatPercentage(0.753, 1) // '75.3%'
 */
export declare function formatPercentage(value: number, decimalPlaces?: number): string;
/**
 * Formats a Date object to Australian datetime format for Google Sheets
 * @param {Date} date - The date to format
 * @returns {string} The formatted datetime string in 'DD/MM/YYYY HH:MM:SS' format
 * @example
 * dateTimeForGS(new Date('2025-01-01T12:34:56')) // '01/01/2025 12:34:56'
 */
export declare function dateTimeForGS(date: Date): string;
//# sourceMappingURL=format-tools.d.ts.map