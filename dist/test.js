import { clearLine, cursorTo } from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { format, sub, set, add, startOfDay, endOfDay, isBefore } from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import require$$0$3, { EventEmitter } from 'events';
import require$$1$1 from 'https';
import require$$2 from 'http';
import require$$3 from 'net';
import require$$4 from 'tls';
import require$$1 from 'crypto';
import require$$0$2 from 'stream';
import require$$7 from 'url';
import require$$0 from 'zlib';
import require$$0$1 from 'buffer';

const ANSI_BACKGROUND_OFFSET = 10;

const wrapAnsi16 = (offset = 0) => code => `\u001B[${code + offset}m`;

const wrapAnsi256 = (offset = 0) => code => `\u001B[${38 + offset};5;${code}m`;

const wrapAnsi16m = (offset = 0) => (red, green, blue) => `\u001B[${38 + offset};2;${red};${green};${blue}m`;

const styles$1 = {
	modifier: {
		reset: [0, 0],
		// 21 isn't widely supported and 22 does the same thing
		bold: [1, 22],
		dim: [2, 22],
		italic: [3, 23],
		underline: [4, 24],
		overline: [53, 55],
		inverse: [7, 27],
		hidden: [8, 28],
		strikethrough: [9, 29],
	},
	color: {
		black: [30, 39],
		red: [31, 39],
		green: [32, 39],
		yellow: [33, 39],
		blue: [34, 39],
		magenta: [35, 39],
		cyan: [36, 39],
		white: [37, 39],

		// Bright color
		blackBright: [90, 39],
		gray: [90, 39], // Alias of `blackBright`
		grey: [90, 39], // Alias of `blackBright`
		redBright: [91, 39],
		greenBright: [92, 39],
		yellowBright: [93, 39],
		blueBright: [94, 39],
		magentaBright: [95, 39],
		cyanBright: [96, 39],
		whiteBright: [97, 39],
	},
	bgColor: {
		bgBlack: [40, 49],
		bgRed: [41, 49],
		bgGreen: [42, 49],
		bgYellow: [43, 49],
		bgBlue: [44, 49],
		bgMagenta: [45, 49],
		bgCyan: [46, 49],
		bgWhite: [47, 49],

		// Bright color
		bgBlackBright: [100, 49],
		bgGray: [100, 49], // Alias of `bgBlackBright`
		bgGrey: [100, 49], // Alias of `bgBlackBright`
		bgRedBright: [101, 49],
		bgGreenBright: [102, 49],
		bgYellowBright: [103, 49],
		bgBlueBright: [104, 49],
		bgMagentaBright: [105, 49],
		bgCyanBright: [106, 49],
		bgWhiteBright: [107, 49],
	},
};

Object.keys(styles$1.modifier);
const foregroundColorNames = Object.keys(styles$1.color);
const backgroundColorNames = Object.keys(styles$1.bgColor);
[...foregroundColorNames, ...backgroundColorNames];

function assembleStyles() {
	const codes = new Map();

	for (const [groupName, group] of Object.entries(styles$1)) {
		for (const [styleName, style] of Object.entries(group)) {
			styles$1[styleName] = {
				open: `\u001B[${style[0]}m`,
				close: `\u001B[${style[1]}m`,
			};

			group[styleName] = styles$1[styleName];

			codes.set(style[0], style[1]);
		}

		Object.defineProperty(styles$1, groupName, {
			value: group,
			enumerable: false,
		});
	}

	Object.defineProperty(styles$1, 'codes', {
		value: codes,
		enumerable: false,
	});

	styles$1.color.close = '\u001B[39m';
	styles$1.bgColor.close = '\u001B[49m';

	styles$1.color.ansi = wrapAnsi16();
	styles$1.color.ansi256 = wrapAnsi256();
	styles$1.color.ansi16m = wrapAnsi16m();
	styles$1.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
	styles$1.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
	styles$1.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);

	// From https://github.com/Qix-/color-convert/blob/3f0e0d4e92e235796ccb17f6e85c72094a651f49/conversions.js
	Object.defineProperties(styles$1, {
		rgbToAnsi256: {
			value(red, green, blue) {
				// We use the extended greyscale palette here, with the exception of
				// black and white. normal palette only has 4 greyscale shades.
				if (red === green && green === blue) {
					if (red < 8) {
						return 16;
					}

					if (red > 248) {
						return 231;
					}

					return Math.round(((red - 8) / 247) * 24) + 232;
				}

				return 16
					+ (36 * Math.round(red / 255 * 5))
					+ (6 * Math.round(green / 255 * 5))
					+ Math.round(blue / 255 * 5);
			},
			enumerable: false,
		},
		hexToRgb: {
			value(hex) {
				const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
				if (!matches) {
					return [0, 0, 0];
				}

				let [colorString] = matches;

				if (colorString.length === 3) {
					colorString = [...colorString].map(character => character + character).join('');
				}

				const integer = Number.parseInt(colorString, 16);

				return [
					/* eslint-disable no-bitwise */
					(integer >> 16) & 0xFF,
					(integer >> 8) & 0xFF,
					integer & 0xFF,
					/* eslint-enable no-bitwise */
				];
			},
			enumerable: false,
		},
		hexToAnsi256: {
			value: hex => styles$1.rgbToAnsi256(...styles$1.hexToRgb(hex)),
			enumerable: false,
		},
		ansi256ToAnsi: {
			value(code) {
				if (code < 8) {
					return 30 + code;
				}

				if (code < 16) {
					return 90 + (code - 8);
				}

				let red;
				let green;
				let blue;

				if (code >= 232) {
					red = (((code - 232) * 10) + 8) / 255;
					green = red;
					blue = red;
				} else {
					code -= 16;

					const remainder = code % 36;

					red = Math.floor(code / 36) / 5;
					green = Math.floor(remainder / 6) / 5;
					blue = (remainder % 6) / 5;
				}

				const value = Math.max(red, green, blue) * 2;

				if (value === 0) {
					return 30;
				}

				// eslint-disable-next-line no-bitwise
				let result = 30 + ((Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red));

				if (value === 2) {
					result += 60;
				}

				return result;
			},
			enumerable: false,
		},
		rgbToAnsi: {
			value: (red, green, blue) => styles$1.ansi256ToAnsi(styles$1.rgbToAnsi256(red, green, blue)),
			enumerable: false,
		},
		hexToAnsi: {
			value: hex => styles$1.ansi256ToAnsi(styles$1.hexToAnsi256(hex)),
			enumerable: false,
		},
	});

	return styles$1;
}

const ansiStyles = assembleStyles();

/* eslint-env browser */

const level = (() => {
	if (!('navigator' in globalThis)) {
		return 0;
	}

	if (globalThis.navigator.userAgentData) {
		const brand = navigator.userAgentData.brands.find(({brand}) => brand === 'Chromium');
		if (brand && brand.version > 93) {
			return 3;
		}
	}

	if (/\b(Chrome|Chromium)\//.test(globalThis.navigator.userAgent)) {
		return 1;
	}

	return 0;
})();

const colorSupport = level !== 0 && {
	level};

const supportsColor = {
	stdout: colorSupport,
	stderr: colorSupport,
};

// TODO: When targeting Node.js 16, use `String.prototype.replaceAll`.
function stringReplaceAll(string, substring, replacer) {
	let index = string.indexOf(substring);
	if (index === -1) {
		return string;
	}

	const substringLength = substring.length;
	let endIndex = 0;
	let returnValue = '';
	do {
		returnValue += string.slice(endIndex, index) + substring + replacer;
		endIndex = index + substringLength;
		index = string.indexOf(substring, endIndex);
	} while (index !== -1);

	returnValue += string.slice(endIndex);
	return returnValue;
}

function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
	let endIndex = 0;
	let returnValue = '';
	do {
		const gotCR = string[index - 1] === '\r';
		returnValue += string.slice(endIndex, (gotCR ? index - 1 : index)) + prefix + (gotCR ? '\r\n' : '\n') + postfix;
		endIndex = index + 1;
		index = string.indexOf('\n', endIndex);
	} while (index !== -1);

	returnValue += string.slice(endIndex);
	return returnValue;
}

const {stdout: stdoutColor, stderr: stderrColor} = supportsColor;

const GENERATOR = Symbol('GENERATOR');
const STYLER = Symbol('STYLER');
const IS_EMPTY = Symbol('IS_EMPTY');

// `supportsColor.level` → `ansiStyles.color[name]` mapping
const levelMapping = [
	'ansi',
	'ansi',
	'ansi256',
	'ansi16m',
];

const styles = Object.create(null);

const applyOptions = (object, options = {}) => {
	if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
		throw new Error('The `level` option should be an integer from 0 to 3');
	}

	// Detect level if not set manually
	const colorLevel = stdoutColor ? stdoutColor.level : 0;
	object.level = options.level === undefined ? colorLevel : options.level;
};

const chalkFactory = options => {
	const chalk = (...strings) => strings.join(' ');
	applyOptions(chalk, options);

	Object.setPrototypeOf(chalk, createChalk.prototype);

	return chalk;
};

function createChalk(options) {
	return chalkFactory(options);
}

Object.setPrototypeOf(createChalk.prototype, Function.prototype);

for (const [styleName, style] of Object.entries(ansiStyles)) {
	styles[styleName] = {
		get() {
			const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
			Object.defineProperty(this, styleName, {value: builder});
			return builder;
		},
	};
}

styles.visible = {
	get() {
		const builder = createBuilder(this, this[STYLER], true);
		Object.defineProperty(this, 'visible', {value: builder});
		return builder;
	},
};

const getModelAnsi = (model, level, type, ...arguments_) => {
	if (model === 'rgb') {
		if (level === 'ansi16m') {
			return ansiStyles[type].ansi16m(...arguments_);
		}

		if (level === 'ansi256') {
			return ansiStyles[type].ansi256(ansiStyles.rgbToAnsi256(...arguments_));
		}

		return ansiStyles[type].ansi(ansiStyles.rgbToAnsi(...arguments_));
	}

	if (model === 'hex') {
		return getModelAnsi('rgb', level, type, ...ansiStyles.hexToRgb(...arguments_));
	}

	return ansiStyles[type][model](...arguments_);
};

const usedModels = ['rgb', 'hex', 'ansi256'];

for (const model of usedModels) {
	styles[model] = {
		get() {
			const {level} = this;
			return function (...arguments_) {
				const styler = createStyler(getModelAnsi(model, levelMapping[level], 'color', ...arguments_), ansiStyles.color.close, this[STYLER]);
				return createBuilder(this, styler, this[IS_EMPTY]);
			};
		},
	};

	const bgModel = 'bg' + model[0].toUpperCase() + model.slice(1);
	styles[bgModel] = {
		get() {
			const {level} = this;
			return function (...arguments_) {
				const styler = createStyler(getModelAnsi(model, levelMapping[level], 'bgColor', ...arguments_), ansiStyles.bgColor.close, this[STYLER]);
				return createBuilder(this, styler, this[IS_EMPTY]);
			};
		},
	};
}

const proto = Object.defineProperties(() => {}, {
	...styles,
	level: {
		enumerable: true,
		get() {
			return this[GENERATOR].level;
		},
		set(level) {
			this[GENERATOR].level = level;
		},
	},
});

const createStyler = (open, close, parent) => {
	let openAll;
	let closeAll;
	if (parent === undefined) {
		openAll = open;
		closeAll = close;
	} else {
		openAll = parent.openAll + open;
		closeAll = close + parent.closeAll;
	}

	return {
		open,
		close,
		openAll,
		closeAll,
		parent,
	};
};

const createBuilder = (self, _styler, _isEmpty) => {
	// Single argument is hot path, implicit coercion is faster than anything
	// eslint-disable-next-line no-implicit-coercion
	const builder = (...arguments_) => applyStyle(builder, (arguments_.length === 1) ? ('' + arguments_[0]) : arguments_.join(' '));

	// We alter the prototype because we must return a function, but there is
	// no way to create a function with a different prototype
	Object.setPrototypeOf(builder, proto);

	builder[GENERATOR] = self;
	builder[STYLER] = _styler;
	builder[IS_EMPTY] = _isEmpty;

	return builder;
};

const applyStyle = (self, string) => {
	if (self.level <= 0 || !string) {
		return self[IS_EMPTY] ? '' : string;
	}

	let styler = self[STYLER];

	if (styler === undefined) {
		return string;
	}

	const {openAll, closeAll} = styler;
	if (string.includes('\u001B')) {
		while (styler !== undefined) {
			// Replace any instances already present with a re-opening code
			// otherwise only the part of the string until said closing code
			// will be colored, and the rest will simply be 'plain'.
			string = stringReplaceAll(string, styler.close, styler.open);

			styler = styler.parent;
		}
	}

	// We can move both next actions out of loop, because remaining actions in loop won't have
	// any/visible effect on parts we add here. Close the styling before a linebreak and reopen
	// after next line to fix a bleed issue on macOS: https://github.com/chalk/chalk/pull/92
	const lfIndex = string.indexOf('\n');
	if (lfIndex !== -1) {
		string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
	}

	return openAll + string + closeAll;
};

Object.defineProperties(createChalk.prototype, styles);

const chalk = createChalk();
createChalk({level: stderrColor ? stderrColor.level : 0});

class DisplayManager {
    static instance;
    promptText = '';
    constructor() { }
    static getInstance() {
        if (!DisplayManager.instance) {
            DisplayManager.instance = new DisplayManager();
        }
        return DisplayManager.instance;
    }
    setPrompt(prompt) {
        this.promptText = prompt;
    }
    /**
     * Logs a message while preserving the prompt at the bottom
     */
    log(message, options) {
        // Clear the current prompt line
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
        // Format the timestamp
        const date = new Date();
        const timestamp = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
        const account = options?.account;
        const symbol = options?.symbol;
        // Build the log message
        let logMessage = `[${timestamp}]${options?.source ? ` [${options.source}] ` : ''}${account ? ` [${account}] ` : ''}${symbol ? ` [${symbol}] ` : ''}${message}`;
        // Add color based on type
        if (options?.type === 'error') {
            logMessage = chalk.red(logMessage);
        }
        else if (options?.type === 'warn') {
            logMessage = chalk.yellow(logMessage);
        }
        // Write the log message
        process.stdout.write(logMessage + '\n');
        // Log to file
        if (symbol) {
            // Log to symbol-specific file if symbol is provided
            this.writeSymbolLog(symbol, date, logMessage, options);
        }
        else if (options?.logToFile) {
            // Log to a generic file if explicitly requested
            this.writeGenericLog(date, logMessage, options);
        }
        // Rewrite the prompt
        this.writePrompt();
    }
    /**
     * Writes a log entry to a symbol-specific log file
     */
    writeSymbolLog(symbol, date, logMessage, options) {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs', { recursive: true });
            }
            // Format date for filename: YYYY-MM-DD
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            // Create filename: SYM-YYYY-MM-DD.log
            const filename = `${symbol}-${year}-${month}-${day}.log`;
            const filePath = path.join('logs', filename);
            // Strip ANSI color codes from log message
            const plainLogMessage = logMessage.replace(/\x1B\[\d+m/g, '');
            // Write to file (append if exists, create if not)
            fs.appendFileSync(filePath, plainLogMessage + '\n');
        }
        catch (error) {
            // Only log to console - don't try to log to file again to avoid potential infinite loop
            process.stdout.write(`Error writing to symbol log file: ${error}\n`);
        }
    }
    /**
     * Writes a log entry to a generic log file when no symbol is provided
     */
    writeGenericLog(date, logMessage, options) {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs', { recursive: true });
            }
            // Format date for filename: YYYY-MM-DD
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            // Create filename: system-YYYY-MM-DD.log
            const source = options?.source?.toLowerCase().replace(/\s+/g, '-') || 'system';
            const filename = `${source}-${year}-${month}-${day}.log`;
            const filePath = path.join('logs', filename);
            // Strip ANSI color codes from log message
            const plainLogMessage = logMessage.replace(/\x1B\[\d+m/g, '');
            // Write to file (append if exists, create if not)
            fs.appendFileSync(filePath, plainLogMessage + '\n');
        }
        catch (error) {
            // Only log to console - don't try to log to file again to avoid potential infinite loop
            process.stdout.write(`Error writing to generic log file: ${error}\n`);
        }
    }
    writePrompt() {
        process.stdout.write(this.promptText);
    }
    clearPrompt() {
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
    }
    restorePrompt() {
        this.writePrompt();
    }
}

/**
 * Logs a message to the console.
 * @param message The message to log.
 * @param options Optional options.
 * @param options.source The source of the message.
 * @param options.type The type of message to log.
 * @param options.symbol The trading symbol associated with this log.
 * @param options.logToFile Force logging to a file even when no symbol is provided.
 */
function log$2(message, options = { source: 'Server', type: 'info' }) {
    const displayManager = DisplayManager.getInstance();
    displayManager.log(message, options);
}

// market-hours.ts
const marketHolidays = {
    2024: {
        'New Year\'s Day': { date: '2024-01-01' },
        'Martin Luther King, Jr. Day': { date: '2024-01-15' },
        'Washington\'s Birthday': { date: '2024-02-19' },
        'Good Friday': { date: '2024-03-29' },
        'Memorial Day': { date: '2024-05-27' },
        'Juneteenth National Independence Day': { date: '2024-06-19' },
        'Independence Day': { date: '2024-07-04' },
        'Labor Day': { date: '2024-09-02' },
        'Thanksgiving Day': { date: '2024-11-28' },
        'Christmas Day': { date: '2024-12-25' }
    },
    2025: {
        'New Year\'s Day': { date: '2025-01-01' },
        'Jimmy Carter Memorial Day': { date: '2025-01-09' },
        'Martin Luther King, Jr. Day': { date: '2025-01-20' },
        'Washington\'s Birthday': { date: '2025-02-17' },
        'Good Friday': { date: '2025-04-18' },
        'Memorial Day': { date: '2025-05-26' },
        'Juneteenth National Independence Day': { date: '2025-06-19' },
        'Independence Day': { date: '2025-07-04' },
        'Labor Day': { date: '2025-09-01' },
        'Thanksgiving Day': { date: '2025-11-27' },
        'Christmas Day': { date: '2025-12-25' }
    },
    2026: {
        'New Year\'s Day': { date: '2026-01-01' },
        'Martin Luther King, Jr. Day': { date: '2026-01-19' },
        'Washington\'s Birthday': { date: '2026-02-16' },
        'Good Friday': { date: '2026-04-03' },
        'Memorial Day': { date: '2026-05-25' },
        'Juneteenth National Independence Day': { date: '2026-06-19' },
        'Independence Day': { date: '2026-07-03' },
        'Labor Day': { date: '2026-09-07' },
        'Thanksgiving Day': { date: '2026-11-26' },
        'Christmas Day': { date: '2026-12-25' }
    }
};
const marketEarlyCloses = {
    2024: {
        '2024-07-03': {
            date: '2024-07-03',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Wednesday, July 3, 2024 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2024-11-29': {
            date: '2024-11-29',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Friday, November 29, 2024 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2024-12-24': {
            date: '2024-12-24',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Tuesday, December 24, 2024 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        }
    },
    2025: {
        '2025-07-03': {
            date: '2025-07-03',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Thursday, July 3, 2025 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2025-11-28': {
            date: '2025-11-28',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Friday, November 28, 2025 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2025-12-24': {
            date: '2025-12-24',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Wednesday, December 24, 2025 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        }
    },
    2026: {
        '2026-07-02': {
            date: '2026-07-02',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Independence Day observed, market closes early at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2026-11-27': {
            date: '2026-11-27',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Friday, November 27, 2026 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2026-12-24': {
            date: '2026-12-24',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Thursday, December 24, 2026 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        }
    }
};

// market-time.ts
/**
 * Market times for NYSE
 * Regular market hours are 9:30am-4:00pm
 * Early market hours are 9:30am-10:00am (first 30 minutes)
 * Extended market hours are 4:00am to 9:30am and 4:00pm-8:00pm
 * On days before some holidays, the market closes early at 1:00pm
 * Early extended market hours are 1:00pm-5:00pm on early close days
 */
const MARKET_TIMES = {
    TIMEZONE: 'America/New_York',
    REGULAR: { START: { HOUR: 9, MINUTE: 30}, END: { HOUR: 16, MINUTE: 0} },
    EXTENDED: { START: { HOUR: 4, MINUTE: 0}, END: { HOUR: 20, MINUTE: 0} },
};
/**
 * Utility class for handling market time-related operations
 */
class MarketTimeUtil {
    timezone;
    intradayReporting;
    /**
     * Creates a new MarketTimeUtil instance
     * @param {string} [timezone='America/New_York'] - The timezone to use for market time calculations
     * @param {IntradayReporting} [intradayReporting='market_hours'] - The intraday reporting mode
     */
    constructor(timezone = MARKET_TIMES.TIMEZONE, intradayReporting = 'market_hours') {
        this.validateTimezone(timezone);
        this.timezone = timezone;
        this.intradayReporting = intradayReporting;
    }
    /**
     * Validates the provided timezone
     * @private
     * @param {string} timezone - The timezone to validate
     * @throws {Error} If the timezone is invalid
     */
    validateTimezone(timezone) {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
        }
        catch (error) {
            throw new Error(`Invalid timezone: ${timezone}`);
        }
    }
    formatDate(date, outputFormat = 'iso') {
        switch (outputFormat) {
            case 'unix-seconds':
                return Math.floor(date.getTime() / 1000);
            case 'unix-ms':
                return date.getTime();
            case 'iso':
            default:
                // return with timezone offset
                return formatInTimeZone(date, this.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
        }
    }
    isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }
    isHoliday(date) {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const yearHolidays = marketHolidays[date.getFullYear()];
        for (const holiday in yearHolidays) {
            if (yearHolidays[holiday].date === formattedDate) {
                return true;
            }
        }
        return false;
    }
    isEarlyCloseDay(date) {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const yearEarlyCloses = marketEarlyCloses[date.getFullYear()];
        return yearEarlyCloses && yearEarlyCloses[formattedDate] !== undefined;
    }
    /**
     * Get the early close time for a given date
     * @param date - The date to get the early close time for
     * @returns The early close time in minutes from midnight, or null if there is no early close
     */
    getEarlyCloseTime(date) {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const yearEarlyCloses = marketEarlyCloses[date.getFullYear()];
        if (yearEarlyCloses && yearEarlyCloses[formattedDate]) {
            const [hours, minutes] = yearEarlyCloses[formattedDate].time.split(':').map(Number);
            return hours * 60 + minutes;
        }
        return null;
    }
    /**
     * Check if a given date is a market day
     * @param date - The date to check
     * @returns true if the date is a market day, false otherwise
     */
    isMarketDay(date) {
        const isWeekendDay = this.isWeekend(date);
        const isHolidayDay = this.isHoliday(date);
        const returner = !isWeekendDay && !isHolidayDay;
        return returner;
    }
    /**
     * Check if a given date is within market hours
     * @param date - The date to check
     * @returns true if the date is within market hours, false otherwise
     */
    isWithinMarketHours(date) {
        // Check for holidays first
        if (this.isHoliday(date)) {
            return false;
        }
        const timeInMinutes = date.getHours() * 60 + date.getMinutes();
        // Check for early closure
        if (this.isEarlyCloseDay(date)) {
            const earlyCloseMinutes = this.getEarlyCloseTime(date);
            if (earlyCloseMinutes !== null && timeInMinutes > earlyCloseMinutes) {
                return false;
            }
        }
        // Regular market hours logic
        let returner;
        switch (this.intradayReporting) {
            case 'extended_hours': {
                const extendedStartMinutes = MARKET_TIMES.EXTENDED.START.HOUR * 60 + MARKET_TIMES.EXTENDED.START.MINUTE;
                const extendedEndMinutes = MARKET_TIMES.EXTENDED.END.HOUR * 60 + MARKET_TIMES.EXTENDED.END.MINUTE;
                // Comprehensive handling of times crossing midnight
                const adjustedDate = timeInMinutes < extendedStartMinutes ? sub(date, { days: 1 }) : date;
                const adjustedTimeInMinutes = adjustedDate.getHours() * 60 + adjustedDate.getMinutes();
                returner = adjustedTimeInMinutes >= extendedStartMinutes && adjustedTimeInMinutes <= extendedEndMinutes;
                break;
            }
            case 'continuous':
                returner = true;
                break;
            default: {
                // market_hours
                const regularStartMinutes = MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
                const regularEndMinutes = MARKET_TIMES.REGULAR.END.HOUR * 60 + MARKET_TIMES.REGULAR.END.MINUTE;
                returner = timeInMinutes >= regularStartMinutes && timeInMinutes <= regularEndMinutes;
                break;
            }
        }
        return returner;
    }
    /**
     * Check if a given date is before market hours
     * @param date - The date to check
     * @returns true if the date is before market hours, false otherwise
     */
    isBeforeMarketHours(date) {
        const timeInMinutes = date.getHours() * 60 + date.getMinutes();
        const startMinutes = this.intradayReporting === 'extended_hours'
            ? MARKET_TIMES.EXTENDED.START.HOUR * 60 + MARKET_TIMES.EXTENDED.START.MINUTE
            : MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
        return timeInMinutes < startMinutes;
    }
    /**
     * Get the last trading date, i.e. the last date that was a market day
     * @param currentDate - The current date
     * @returns The last trading date
     */
    getLastTradingDate(currentDate = new Date()) {
        const nowET = toZonedTime(currentDate, this.timezone);
        const isMarketDayToday = this.isMarketDay(nowET);
        const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
        const marketOpenMinutes = MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
        if (isMarketDayToday && currentMinutes >= marketOpenMinutes) {
            // After market open on a market day, return today
            return nowET;
        }
        else {
            // Before market open, or not a market day, return previous trading day
            let lastTradingDate = sub(nowET, { days: 1 });
            while (!this.isMarketDay(lastTradingDate)) {
                lastTradingDate = sub(lastTradingDate, { days: 1 });
            }
            return lastTradingDate;
        }
    }
    getLastMarketDay(date) {
        let currentDate = sub(date, { days: 1 });
        while (!this.isMarketDay(currentDate)) {
            currentDate = sub(currentDate, { days: 1 });
        }
        return currentDate;
    }
    getLastFullTradingDate(currentDate = new Date()) {
        const nowET = toZonedTime(currentDate, this.timezone);
        // If today is a market day and we're after extended hours close
        // then return today since it's a completed trading day
        if (this.isMarketDay(nowET)) {
            const timeInMinutes = nowET.getHours() * 60 + nowET.getMinutes();
            const extendedEndMinutes = MARKET_TIMES.EXTENDED.END.HOUR * 60 + MARKET_TIMES.EXTENDED.END.MINUTE;
            // Check if we're after market close (including extended hours)
            if (timeInMinutes >= extendedEndMinutes) {
                // Set to midnight ET while preserving the date
                return fromZonedTime(set(nowET, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }), this.timezone);
            }
        }
        // In all other cases (during trading hours, before market open, holidays, weekends),
        // we want the last completed trading day
        let lastFullDate = this.getLastMarketDay(nowET);
        // Set to midnight ET while preserving the date
        return fromZonedTime(set(lastFullDate, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }), this.timezone);
    }
    /**
     * Gets the next market day from a reference date
     * @param {Object} [options] - Options object
     * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
     * @returns {Object} The next market day information
     * @property {Date} date - The date object (start of day in NY time)
     * @property {string} yyyymmdd - The date in YYYY-MM-DD format
     * @property {string} dateISOString - Full ISO date string
     */
    getNextMarketDay(date) {
        let currentDate = add(date, { days: 1 });
        while (!this.isMarketDay(currentDate)) {
            currentDate = add(currentDate, { days: 1 });
        }
        return currentDate;
    }
    getDayBoundaries(date) {
        let start;
        let end;
        switch (this.intradayReporting) {
            case 'extended_hours': {
                start = set(date, {
                    hours: MARKET_TIMES.EXTENDED.START.HOUR,
                    minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
                    seconds: 0,
                    milliseconds: 0,
                });
                end = set(date, {
                    hours: MARKET_TIMES.EXTENDED.END.HOUR,
                    minutes: MARKET_TIMES.EXTENDED.END.MINUTE,
                    seconds: 59,
                    milliseconds: 999,
                });
                break;
            }
            case 'continuous': {
                start = startOfDay(date);
                end = endOfDay(date);
                break;
            }
            default: {
                // market_hours
                start = set(date, {
                    hours: MARKET_TIMES.REGULAR.START.HOUR,
                    minutes: MARKET_TIMES.REGULAR.START.MINUTE,
                    seconds: 0,
                    milliseconds: 0,
                });
                // Check for early close
                if (this.isEarlyCloseDay(date)) {
                    const earlyCloseMinutes = this.getEarlyCloseTime(date);
                    if (earlyCloseMinutes !== null) {
                        const earlyCloseHours = Math.floor(earlyCloseMinutes / 60);
                        const earlyCloseMinutesRemainder = earlyCloseMinutes % 60;
                        end = set(date, {
                            hours: earlyCloseHours,
                            minutes: earlyCloseMinutesRemainder,
                            seconds: 59,
                            milliseconds: 999,
                        });
                        break;
                    }
                }
                end = set(date, {
                    hours: MARKET_TIMES.REGULAR.END.HOUR,
                    minutes: MARKET_TIMES.REGULAR.END.MINUTE,
                    seconds: 59,
                    milliseconds: 999,
                });
                break;
            }
        }
        return { start, end };
    }
    calculatePeriodStartDate(endDate, period) {
        let startDate;
        switch (period) {
            case 'YTD':
                startDate = set(endDate, { month: 0, date: 1 });
                break;
            case '1D':
                startDate = this.getLastMarketDay(endDate);
                break;
            case '3D':
                startDate = sub(endDate, { days: 3 });
                break;
            case '1W':
                startDate = sub(endDate, { weeks: 1 });
                break;
            case '2W':
                startDate = sub(endDate, { weeks: 2 });
                break;
            case '1M':
                startDate = sub(endDate, { months: 1 });
                break;
            case '3M':
                startDate = sub(endDate, { months: 3 });
                break;
            case '6M':
                startDate = sub(endDate, { months: 6 });
                break;
            case '1Y':
                startDate = sub(endDate, { years: 1 });
                break;
            default:
                throw new Error(`Invalid period: ${period}`);
        }
        while (!this.isMarketDay(startDate)) {
            startDate = this.getNextMarketDay(startDate);
        }
        return startDate;
    }
    getMarketTimePeriod({ period, end = new Date(), intraday_reporting, outputFormat = 'iso', }) {
        if (!period) {
            throw new Error('Period is required');
        }
        if (intraday_reporting) {
            this.intradayReporting = intraday_reporting;
        }
        // Convert end date to specified timezone
        const zonedEndDate = toZonedTime(end, this.timezone);
        let startDate;
        let endDate;
        const isCurrentMarketDay = this.isMarketDay(zonedEndDate);
        const isWithinHours = this.isWithinMarketHours(zonedEndDate);
        const isBeforeHours = this.isBeforeMarketHours(zonedEndDate);
        // First determine the end date based on current market conditions
        if (isCurrentMarketDay) {
            if (isBeforeHours) {
                // Case 1: Market day before open hours - use previous full trading day
                const lastMarketDay = this.getLastMarketDay(zonedEndDate);
                const { end: dayEnd } = this.getDayBoundaries(lastMarketDay);
                endDate = dayEnd;
            }
            else if (isWithinHours) {
                // Case 2: Market day during hours - use current time
                endDate = zonedEndDate;
            }
            else {
                // Case 3: Market day after close - use today's close
                const { end: dayEnd } = this.getDayBoundaries(zonedEndDate);
                endDate = dayEnd;
            }
        }
        else {
            // Case 4: Not a market day - use previous market day's close
            const lastMarketDay = this.getLastMarketDay(zonedEndDate);
            const { end: dayEnd } = this.getDayBoundaries(lastMarketDay);
            endDate = dayEnd;
        }
        // Now calculate the start date based on the period
        const periodStartDate = this.calculatePeriodStartDate(endDate, period);
        const { start: dayStart } = this.getDayBoundaries(periodStartDate);
        startDate = dayStart;
        // Convert boundaries back to UTC for final output
        const utcStart = fromZonedTime(startDate, this.timezone);
        const utcEnd = fromZonedTime(endDate, this.timezone);
        // Ensure start is not after end
        if (isBefore(utcEnd, utcStart)) {
            throw new Error('Start date cannot be after end date');
        }
        return {
            start: this.formatDate(utcStart, outputFormat),
            end: this.formatDate(utcEnd, outputFormat),
        };
    }
    getMarketOpenClose(options = {}) {
        const { date = new Date() } = options;
        const zonedDate = toZonedTime(date, this.timezone);
        // Check if market is closed for the day
        if (this.isWeekend(zonedDate) || this.isHoliday(zonedDate)) {
            return {
                marketOpen: false,
                open: null,
                close: null,
                openExt: null,
                closeExt: null,
            };
        }
        const dayStart = startOfDay(zonedDate);
        const regularOpenTime = MARKET_TIMES.REGULAR.START;
        let regularCloseTime = MARKET_TIMES.REGULAR.END;
        const extendedOpenTime = MARKET_TIMES.EXTENDED.START;
        let extendedCloseTime = MARKET_TIMES.EXTENDED.END;
        // Check for early close
        const isEarlyClose = this.isEarlyCloseDay(zonedDate);
        if (isEarlyClose) {
            const earlyCloseMinutes = this.getEarlyCloseTime(zonedDate);
            if (earlyCloseMinutes !== null) {
                // For regular hours, use the early close time
                regularCloseTime = {
                    HOUR: Math.floor(earlyCloseMinutes / 60),
                    MINUTE: earlyCloseMinutes % 60,
                    MINUTES: earlyCloseMinutes,
                };
                // For extended hours on early close days, close at 5:00 PM
                extendedCloseTime = {
                    HOUR: 17,
                    MINUTE: 0,
                    MINUTES: 1020,
                };
            }
        }
        const open = fromZonedTime(set(dayStart, { hours: regularOpenTime.HOUR, minutes: regularOpenTime.MINUTE }), this.timezone);
        const close = fromZonedTime(set(dayStart, { hours: regularCloseTime.HOUR, minutes: regularCloseTime.MINUTE }), this.timezone);
        const openExt = fromZonedTime(set(dayStart, { hours: extendedOpenTime.HOUR, minutes: extendedOpenTime.MINUTE }), this.timezone);
        const closeExt = fromZonedTime(set(dayStart, { hours: extendedCloseTime.HOUR, minutes: extendedCloseTime.MINUTE }), this.timezone);
        return {
            marketOpen: true,
            open,
            close,
            openExt,
            closeExt,
        };
    }
}
/**
 * Gets the last full trading date
 * @param {Date} [currentDate] - The current date (defaults to now)
 * @returns {Object} The last full trading date
 * @property {Date} date - The date object
 * @property {string} YYYYMMDD - The date in YYYY-MM-DD format
 */
function getLastFullTradingDate(currentDate = new Date()) {
    const util = new MarketTimeUtil();
    const date = util.getLastFullTradingDate(currentDate);
    // Format the date in NY timezone to ensure consistency
    return {
        date,
        YYYYMMDD: formatInTimeZone(date, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd'),
    };
}

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var bufferUtil = {exports: {}};

var constants;
var hasRequiredConstants;

function requireConstants () {
	if (hasRequiredConstants) return constants;
	hasRequiredConstants = 1;

	const BINARY_TYPES = ['nodebuffer', 'arraybuffer', 'fragments'];
	const hasBlob = typeof Blob !== 'undefined';

	if (hasBlob) BINARY_TYPES.push('blob');

	constants = {
	  BINARY_TYPES,
	  EMPTY_BUFFER: Buffer.alloc(0),
	  GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
	  hasBlob,
	  kForOnEventAttribute: Symbol('kIsForOnEventAttribute'),
	  kListener: Symbol('kListener'),
	  kStatusCode: Symbol('status-code'),
	  kWebSocket: Symbol('websocket'),
	  NOOP: () => {}
	};
	return constants;
}

var hasRequiredBufferUtil;

function requireBufferUtil () {
	if (hasRequiredBufferUtil) return bufferUtil.exports;
	hasRequiredBufferUtil = 1;

	const { EMPTY_BUFFER } = requireConstants();

	const FastBuffer = Buffer[Symbol.species];

	/**
	 * Merges an array of buffers into a new buffer.
	 *
	 * @param {Buffer[]} list The array of buffers to concat
	 * @param {Number} totalLength The total length of buffers in the list
	 * @return {Buffer} The resulting buffer
	 * @public
	 */
	function concat(list, totalLength) {
	  if (list.length === 0) return EMPTY_BUFFER;
	  if (list.length === 1) return list[0];

	  const target = Buffer.allocUnsafe(totalLength);
	  let offset = 0;

	  for (let i = 0; i < list.length; i++) {
	    const buf = list[i];
	    target.set(buf, offset);
	    offset += buf.length;
	  }

	  if (offset < totalLength) {
	    return new FastBuffer(target.buffer, target.byteOffset, offset);
	  }

	  return target;
	}

	/**
	 * Masks a buffer using the given mask.
	 *
	 * @param {Buffer} source The buffer to mask
	 * @param {Buffer} mask The mask to use
	 * @param {Buffer} output The buffer where to store the result
	 * @param {Number} offset The offset at which to start writing
	 * @param {Number} length The number of bytes to mask.
	 * @public
	 */
	function _mask(source, mask, output, offset, length) {
	  for (let i = 0; i < length; i++) {
	    output[offset + i] = source[i] ^ mask[i & 3];
	  }
	}

	/**
	 * Unmasks a buffer using the given mask.
	 *
	 * @param {Buffer} buffer The buffer to unmask
	 * @param {Buffer} mask The mask to use
	 * @public
	 */
	function _unmask(buffer, mask) {
	  for (let i = 0; i < buffer.length; i++) {
	    buffer[i] ^= mask[i & 3];
	  }
	}

	/**
	 * Converts a buffer to an `ArrayBuffer`.
	 *
	 * @param {Buffer} buf The buffer to convert
	 * @return {ArrayBuffer} Converted buffer
	 * @public
	 */
	function toArrayBuffer(buf) {
	  if (buf.length === buf.buffer.byteLength) {
	    return buf.buffer;
	  }

	  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
	}

	/**
	 * Converts `data` to a `Buffer`.
	 *
	 * @param {*} data The data to convert
	 * @return {Buffer} The buffer
	 * @throws {TypeError}
	 * @public
	 */
	function toBuffer(data) {
	  toBuffer.readOnly = true;

	  if (Buffer.isBuffer(data)) return data;

	  let buf;

	  if (data instanceof ArrayBuffer) {
	    buf = new FastBuffer(data);
	  } else if (ArrayBuffer.isView(data)) {
	    buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
	  } else {
	    buf = Buffer.from(data);
	    toBuffer.readOnly = false;
	  }

	  return buf;
	}

	bufferUtil.exports = {
	  concat,
	  mask: _mask,
	  toArrayBuffer,
	  toBuffer,
	  unmask: _unmask
	};

	/* istanbul ignore else  */
	if (!process.env.WS_NO_BUFFER_UTIL) {
	  try {
	    const bufferUtil$1 = require('bufferutil');

	    bufferUtil.exports.mask = function (source, mask, output, offset, length) {
	      if (length < 48) _mask(source, mask, output, offset, length);
	      else bufferUtil$1.mask(source, mask, output, offset, length);
	    };

	    bufferUtil.exports.unmask = function (buffer, mask) {
	      if (buffer.length < 32) _unmask(buffer, mask);
	      else bufferUtil$1.unmask(buffer, mask);
	    };
	  } catch (e) {
	    // Continue regardless of the error.
	  }
	}
	return bufferUtil.exports;
}

var limiter;
var hasRequiredLimiter;

function requireLimiter () {
	if (hasRequiredLimiter) return limiter;
	hasRequiredLimiter = 1;

	const kDone = Symbol('kDone');
	const kRun = Symbol('kRun');

	/**
	 * A very simple job queue with adjustable concurrency. Adapted from
	 * https://github.com/STRML/async-limiter
	 */
	class Limiter {
	  /**
	   * Creates a new `Limiter`.
	   *
	   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
	   *     to run concurrently
	   */
	  constructor(concurrency) {
	    this[kDone] = () => {
	      this.pending--;
	      this[kRun]();
	    };
	    this.concurrency = concurrency || Infinity;
	    this.jobs = [];
	    this.pending = 0;
	  }

	  /**
	   * Adds a job to the queue.
	   *
	   * @param {Function} job The job to run
	   * @public
	   */
	  add(job) {
	    this.jobs.push(job);
	    this[kRun]();
	  }

	  /**
	   * Removes a job from the queue and runs it if possible.
	   *
	   * @private
	   */
	  [kRun]() {
	    if (this.pending === this.concurrency) return;

	    if (this.jobs.length) {
	      const job = this.jobs.shift();

	      this.pending++;
	      job(this[kDone]);
	    }
	  }
	}

	limiter = Limiter;
	return limiter;
}

var permessageDeflate;
var hasRequiredPermessageDeflate;

function requirePermessageDeflate () {
	if (hasRequiredPermessageDeflate) return permessageDeflate;
	hasRequiredPermessageDeflate = 1;

	const zlib = require$$0;

	const bufferUtil = requireBufferUtil();
	const Limiter = requireLimiter();
	const { kStatusCode } = requireConstants();

	const FastBuffer = Buffer[Symbol.species];
	const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
	const kPerMessageDeflate = Symbol('permessage-deflate');
	const kTotalLength = Symbol('total-length');
	const kCallback = Symbol('callback');
	const kBuffers = Symbol('buffers');
	const kError = Symbol('error');

	//
	// We limit zlib concurrency, which prevents severe memory fragmentation
	// as documented in https://github.com/nodejs/node/issues/8871#issuecomment-250915913
	// and https://github.com/websockets/ws/issues/1202
	//
	// Intentionally global; it's the global thread pool that's an issue.
	//
	let zlibLimiter;

	/**
	 * permessage-deflate implementation.
	 */
	class PerMessageDeflate {
	  /**
	   * Creates a PerMessageDeflate instance.
	   *
	   * @param {Object} [options] Configuration options
	   * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
	   *     for, or request, a custom client window size
	   * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
	   *     acknowledge disabling of client context takeover
	   * @param {Number} [options.concurrencyLimit=10] The number of concurrent
	   *     calls to zlib
	   * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
	   *     use of a custom server window size
	   * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
	   *     disabling of server context takeover
	   * @param {Number} [options.threshold=1024] Size (in bytes) below which
	   *     messages should not be compressed if context takeover is disabled
	   * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
	   *     deflate
	   * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
	   *     inflate
	   * @param {Boolean} [isServer=false] Create the instance in either server or
	   *     client mode
	   * @param {Number} [maxPayload=0] The maximum allowed message length
	   */
	  constructor(options, isServer, maxPayload) {
	    this._maxPayload = maxPayload | 0;
	    this._options = options || {};
	    this._threshold =
	      this._options.threshold !== undefined ? this._options.threshold : 1024;
	    this._isServer = !!isServer;
	    this._deflate = null;
	    this._inflate = null;

	    this.params = null;

	    if (!zlibLimiter) {
	      const concurrency =
	        this._options.concurrencyLimit !== undefined
	          ? this._options.concurrencyLimit
	          : 10;
	      zlibLimiter = new Limiter(concurrency);
	    }
	  }

	  /**
	   * @type {String}
	   */
	  static get extensionName() {
	    return 'permessage-deflate';
	  }

	  /**
	   * Create an extension negotiation offer.
	   *
	   * @return {Object} Extension parameters
	   * @public
	   */
	  offer() {
	    const params = {};

	    if (this._options.serverNoContextTakeover) {
	      params.server_no_context_takeover = true;
	    }
	    if (this._options.clientNoContextTakeover) {
	      params.client_no_context_takeover = true;
	    }
	    if (this._options.serverMaxWindowBits) {
	      params.server_max_window_bits = this._options.serverMaxWindowBits;
	    }
	    if (this._options.clientMaxWindowBits) {
	      params.client_max_window_bits = this._options.clientMaxWindowBits;
	    } else if (this._options.clientMaxWindowBits == null) {
	      params.client_max_window_bits = true;
	    }

	    return params;
	  }

	  /**
	   * Accept an extension negotiation offer/response.
	   *
	   * @param {Array} configurations The extension negotiation offers/reponse
	   * @return {Object} Accepted configuration
	   * @public
	   */
	  accept(configurations) {
	    configurations = this.normalizeParams(configurations);

	    this.params = this._isServer
	      ? this.acceptAsServer(configurations)
	      : this.acceptAsClient(configurations);

	    return this.params;
	  }

	  /**
	   * Releases all resources used by the extension.
	   *
	   * @public
	   */
	  cleanup() {
	    if (this._inflate) {
	      this._inflate.close();
	      this._inflate = null;
	    }

	    if (this._deflate) {
	      const callback = this._deflate[kCallback];

	      this._deflate.close();
	      this._deflate = null;

	      if (callback) {
	        callback(
	          new Error(
	            'The deflate stream was closed while data was being processed'
	          )
	        );
	      }
	    }
	  }

	  /**
	   *  Accept an extension negotiation offer.
	   *
	   * @param {Array} offers The extension negotiation offers
	   * @return {Object} Accepted configuration
	   * @private
	   */
	  acceptAsServer(offers) {
	    const opts = this._options;
	    const accepted = offers.find((params) => {
	      if (
	        (opts.serverNoContextTakeover === false &&
	          params.server_no_context_takeover) ||
	        (params.server_max_window_bits &&
	          (opts.serverMaxWindowBits === false ||
	            (typeof opts.serverMaxWindowBits === 'number' &&
	              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
	        (typeof opts.clientMaxWindowBits === 'number' &&
	          !params.client_max_window_bits)
	      ) {
	        return false;
	      }

	      return true;
	    });

	    if (!accepted) {
	      throw new Error('None of the extension offers can be accepted');
	    }

	    if (opts.serverNoContextTakeover) {
	      accepted.server_no_context_takeover = true;
	    }
	    if (opts.clientNoContextTakeover) {
	      accepted.client_no_context_takeover = true;
	    }
	    if (typeof opts.serverMaxWindowBits === 'number') {
	      accepted.server_max_window_bits = opts.serverMaxWindowBits;
	    }
	    if (typeof opts.clientMaxWindowBits === 'number') {
	      accepted.client_max_window_bits = opts.clientMaxWindowBits;
	    } else if (
	      accepted.client_max_window_bits === true ||
	      opts.clientMaxWindowBits === false
	    ) {
	      delete accepted.client_max_window_bits;
	    }

	    return accepted;
	  }

	  /**
	   * Accept the extension negotiation response.
	   *
	   * @param {Array} response The extension negotiation response
	   * @return {Object} Accepted configuration
	   * @private
	   */
	  acceptAsClient(response) {
	    const params = response[0];

	    if (
	      this._options.clientNoContextTakeover === false &&
	      params.client_no_context_takeover
	    ) {
	      throw new Error('Unexpected parameter "client_no_context_takeover"');
	    }

	    if (!params.client_max_window_bits) {
	      if (typeof this._options.clientMaxWindowBits === 'number') {
	        params.client_max_window_bits = this._options.clientMaxWindowBits;
	      }
	    } else if (
	      this._options.clientMaxWindowBits === false ||
	      (typeof this._options.clientMaxWindowBits === 'number' &&
	        params.client_max_window_bits > this._options.clientMaxWindowBits)
	    ) {
	      throw new Error(
	        'Unexpected or invalid parameter "client_max_window_bits"'
	      );
	    }

	    return params;
	  }

	  /**
	   * Normalize parameters.
	   *
	   * @param {Array} configurations The extension negotiation offers/reponse
	   * @return {Array} The offers/response with normalized parameters
	   * @private
	   */
	  normalizeParams(configurations) {
	    configurations.forEach((params) => {
	      Object.keys(params).forEach((key) => {
	        let value = params[key];

	        if (value.length > 1) {
	          throw new Error(`Parameter "${key}" must have only a single value`);
	        }

	        value = value[0];

	        if (key === 'client_max_window_bits') {
	          if (value !== true) {
	            const num = +value;
	            if (!Number.isInteger(num) || num < 8 || num > 15) {
	              throw new TypeError(
	                `Invalid value for parameter "${key}": ${value}`
	              );
	            }
	            value = num;
	          } else if (!this._isServer) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	        } else if (key === 'server_max_window_bits') {
	          const num = +value;
	          if (!Number.isInteger(num) || num < 8 || num > 15) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	          value = num;
	        } else if (
	          key === 'client_no_context_takeover' ||
	          key === 'server_no_context_takeover'
	        ) {
	          if (value !== true) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	        } else {
	          throw new Error(`Unknown parameter "${key}"`);
	        }

	        params[key] = value;
	      });
	    });

	    return configurations;
	  }

	  /**
	   * Decompress data. Concurrency limited.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @public
	   */
	  decompress(data, fin, callback) {
	    zlibLimiter.add((done) => {
	      this._decompress(data, fin, (err, result) => {
	        done();
	        callback(err, result);
	      });
	    });
	  }

	  /**
	   * Compress data. Concurrency limited.
	   *
	   * @param {(Buffer|String)} data Data to compress
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @public
	   */
	  compress(data, fin, callback) {
	    zlibLimiter.add((done) => {
	      this._compress(data, fin, (err, result) => {
	        done();
	        callback(err, result);
	      });
	    });
	  }

	  /**
	   * Decompress data.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @private
	   */
	  _decompress(data, fin, callback) {
	    const endpoint = this._isServer ? 'client' : 'server';

	    if (!this._inflate) {
	      const key = `${endpoint}_max_window_bits`;
	      const windowBits =
	        typeof this.params[key] !== 'number'
	          ? zlib.Z_DEFAULT_WINDOWBITS
	          : this.params[key];

	      this._inflate = zlib.createInflateRaw({
	        ...this._options.zlibInflateOptions,
	        windowBits
	      });
	      this._inflate[kPerMessageDeflate] = this;
	      this._inflate[kTotalLength] = 0;
	      this._inflate[kBuffers] = [];
	      this._inflate.on('error', inflateOnError);
	      this._inflate.on('data', inflateOnData);
	    }

	    this._inflate[kCallback] = callback;

	    this._inflate.write(data);
	    if (fin) this._inflate.write(TRAILER);

	    this._inflate.flush(() => {
	      const err = this._inflate[kError];

	      if (err) {
	        this._inflate.close();
	        this._inflate = null;
	        callback(err);
	        return;
	      }

	      const data = bufferUtil.concat(
	        this._inflate[kBuffers],
	        this._inflate[kTotalLength]
	      );

	      if (this._inflate._readableState.endEmitted) {
	        this._inflate.close();
	        this._inflate = null;
	      } else {
	        this._inflate[kTotalLength] = 0;
	        this._inflate[kBuffers] = [];

	        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
	          this._inflate.reset();
	        }
	      }

	      callback(null, data);
	    });
	  }

	  /**
	   * Compress data.
	   *
	   * @param {(Buffer|String)} data Data to compress
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @private
	   */
	  _compress(data, fin, callback) {
	    const endpoint = this._isServer ? 'server' : 'client';

	    if (!this._deflate) {
	      const key = `${endpoint}_max_window_bits`;
	      const windowBits =
	        typeof this.params[key] !== 'number'
	          ? zlib.Z_DEFAULT_WINDOWBITS
	          : this.params[key];

	      this._deflate = zlib.createDeflateRaw({
	        ...this._options.zlibDeflateOptions,
	        windowBits
	      });

	      this._deflate[kTotalLength] = 0;
	      this._deflate[kBuffers] = [];

	      this._deflate.on('data', deflateOnData);
	    }

	    this._deflate[kCallback] = callback;

	    this._deflate.write(data);
	    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
	      if (!this._deflate) {
	        //
	        // The deflate stream was closed while data was being processed.
	        //
	        return;
	      }

	      let data = bufferUtil.concat(
	        this._deflate[kBuffers],
	        this._deflate[kTotalLength]
	      );

	      if (fin) {
	        data = new FastBuffer(data.buffer, data.byteOffset, data.length - 4);
	      }

	      //
	      // Ensure that the callback will not be called again in
	      // `PerMessageDeflate#cleanup()`.
	      //
	      this._deflate[kCallback] = null;

	      this._deflate[kTotalLength] = 0;
	      this._deflate[kBuffers] = [];

	      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
	        this._deflate.reset();
	      }

	      callback(null, data);
	    });
	  }
	}

	permessageDeflate = PerMessageDeflate;

	/**
	 * The listener of the `zlib.DeflateRaw` stream `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function deflateOnData(chunk) {
	  this[kBuffers].push(chunk);
	  this[kTotalLength] += chunk.length;
	}

	/**
	 * The listener of the `zlib.InflateRaw` stream `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function inflateOnData(chunk) {
	  this[kTotalLength] += chunk.length;

	  if (
	    this[kPerMessageDeflate]._maxPayload < 1 ||
	    this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload
	  ) {
	    this[kBuffers].push(chunk);
	    return;
	  }

	  this[kError] = new RangeError('Max payload size exceeded');
	  this[kError].code = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
	  this[kError][kStatusCode] = 1009;
	  this.removeListener('data', inflateOnData);

	  //
	  // The choice to employ `zlib.reset()` over `zlib.close()` is dictated by the
	  // fact that in Node.js versions prior to 13.10.0, the callback for
	  // `zlib.flush()` is not called if `zlib.close()` is used. Utilizing
	  // `zlib.reset()` ensures that either the callback is invoked or an error is
	  // emitted.
	  //
	  this.reset();
	}

	/**
	 * The listener of the `zlib.InflateRaw` stream `'error'` event.
	 *
	 * @param {Error} err The emitted error
	 * @private
	 */
	function inflateOnError(err) {
	  //
	  // There is no need to call `Zlib#close()` as the handle is automatically
	  // closed when an error is emitted.
	  //
	  this[kPerMessageDeflate]._inflate = null;

	  if (this[kError]) {
	    this[kCallback](this[kError]);
	    return;
	  }

	  err[kStatusCode] = 1007;
	  this[kCallback](err);
	}
	return permessageDeflate;
}

var validation = {exports: {}};

var hasRequiredValidation;

function requireValidation () {
	if (hasRequiredValidation) return validation.exports;
	hasRequiredValidation = 1;

	const { isUtf8 } = require$$0$1;

	const { hasBlob } = requireConstants();

	//
	// Allowed token characters:
	//
	// '!', '#', '$', '%', '&', ''', '*', '+', '-',
	// '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
	//
	// tokenChars[32] === 0 // ' '
	// tokenChars[33] === 1 // '!'
	// tokenChars[34] === 0 // '"'
	// ...
	//
	// prettier-ignore
	const tokenChars = [
	  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
	  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
	  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
	  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
	];

	/**
	 * Checks if a status code is allowed in a close frame.
	 *
	 * @param {Number} code The status code
	 * @return {Boolean} `true` if the status code is valid, else `false`
	 * @public
	 */
	function isValidStatusCode(code) {
	  return (
	    (code >= 1000 &&
	      code <= 1014 &&
	      code !== 1004 &&
	      code !== 1005 &&
	      code !== 1006) ||
	    (code >= 3000 && code <= 4999)
	  );
	}

	/**
	 * Checks if a given buffer contains only correct UTF-8.
	 * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
	 * Markus Kuhn.
	 *
	 * @param {Buffer} buf The buffer to check
	 * @return {Boolean} `true` if `buf` contains only correct UTF-8, else `false`
	 * @public
	 */
	function _isValidUTF8(buf) {
	  const len = buf.length;
	  let i = 0;

	  while (i < len) {
	    if ((buf[i] & 0x80) === 0) {
	      // 0xxxxxxx
	      i++;
	    } else if ((buf[i] & 0xe0) === 0xc0) {
	      // 110xxxxx 10xxxxxx
	      if (
	        i + 1 === len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i] & 0xfe) === 0xc0 // Overlong
	      ) {
	        return false;
	      }

	      i += 2;
	    } else if ((buf[i] & 0xf0) === 0xe0) {
	      // 1110xxxx 10xxxxxx 10xxxxxx
	      if (
	        i + 2 >= len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i + 2] & 0xc0) !== 0x80 ||
	        (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) || // Overlong
	        (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
	      ) {
	        return false;
	      }

	      i += 3;
	    } else if ((buf[i] & 0xf8) === 0xf0) {
	      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
	      if (
	        i + 3 >= len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i + 2] & 0xc0) !== 0x80 ||
	        (buf[i + 3] & 0xc0) !== 0x80 ||
	        (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) || // Overlong
	        (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
	        buf[i] > 0xf4 // > U+10FFFF
	      ) {
	        return false;
	      }

	      i += 4;
	    } else {
	      return false;
	    }
	  }

	  return true;
	}

	/**
	 * Determines whether a value is a `Blob`.
	 *
	 * @param {*} value The value to be tested
	 * @return {Boolean} `true` if `value` is a `Blob`, else `false`
	 * @private
	 */
	function isBlob(value) {
	  return (
	    hasBlob &&
	    typeof value === 'object' &&
	    typeof value.arrayBuffer === 'function' &&
	    typeof value.type === 'string' &&
	    typeof value.stream === 'function' &&
	    (value[Symbol.toStringTag] === 'Blob' ||
	      value[Symbol.toStringTag] === 'File')
	  );
	}

	validation.exports = {
	  isBlob,
	  isValidStatusCode,
	  isValidUTF8: _isValidUTF8,
	  tokenChars
	};

	if (isUtf8) {
	  validation.exports.isValidUTF8 = function (buf) {
	    return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
	  };
	} /* istanbul ignore else  */ else if (!process.env.WS_NO_UTF_8_VALIDATE) {
	  try {
	    const isValidUTF8 = require('utf-8-validate');

	    validation.exports.isValidUTF8 = function (buf) {
	      return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
	    };
	  } catch (e) {
	    // Continue regardless of the error.
	  }
	}
	return validation.exports;
}

var receiver;
var hasRequiredReceiver;

function requireReceiver () {
	if (hasRequiredReceiver) return receiver;
	hasRequiredReceiver = 1;

	const { Writable } = require$$0$2;

	const PerMessageDeflate = requirePermessageDeflate();
	const {
	  BINARY_TYPES,
	  EMPTY_BUFFER,
	  kStatusCode,
	  kWebSocket
	} = requireConstants();
	const { concat, toArrayBuffer, unmask } = requireBufferUtil();
	const { isValidStatusCode, isValidUTF8 } = requireValidation();

	const FastBuffer = Buffer[Symbol.species];

	const GET_INFO = 0;
	const GET_PAYLOAD_LENGTH_16 = 1;
	const GET_PAYLOAD_LENGTH_64 = 2;
	const GET_MASK = 3;
	const GET_DATA = 4;
	const INFLATING = 5;
	const DEFER_EVENT = 6;

	/**
	 * HyBi Receiver implementation.
	 *
	 * @extends Writable
	 */
	class Receiver extends Writable {
	  /**
	   * Creates a Receiver instance.
	   *
	   * @param {Object} [options] Options object
	   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {String} [options.binaryType=nodebuffer] The type for binary data
	   * @param {Object} [options.extensions] An object containing the negotiated
	   *     extensions
	   * @param {Boolean} [options.isServer=false] Specifies whether to operate in
	   *     client or server mode
	   * @param {Number} [options.maxPayload=0] The maximum allowed message length
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   */
	  constructor(options = {}) {
	    super();

	    this._allowSynchronousEvents =
	      options.allowSynchronousEvents !== undefined
	        ? options.allowSynchronousEvents
	        : true;
	    this._binaryType = options.binaryType || BINARY_TYPES[0];
	    this._extensions = options.extensions || {};
	    this._isServer = !!options.isServer;
	    this._maxPayload = options.maxPayload | 0;
	    this._skipUTF8Validation = !!options.skipUTF8Validation;
	    this[kWebSocket] = undefined;

	    this._bufferedBytes = 0;
	    this._buffers = [];

	    this._compressed = false;
	    this._payloadLength = 0;
	    this._mask = undefined;
	    this._fragmented = 0;
	    this._masked = false;
	    this._fin = false;
	    this._opcode = 0;

	    this._totalPayloadLength = 0;
	    this._messageLength = 0;
	    this._fragments = [];

	    this._errored = false;
	    this._loop = false;
	    this._state = GET_INFO;
	  }

	  /**
	   * Implements `Writable.prototype._write()`.
	   *
	   * @param {Buffer} chunk The chunk of data to write
	   * @param {String} encoding The character encoding of `chunk`
	   * @param {Function} cb Callback
	   * @private
	   */
	  _write(chunk, encoding, cb) {
	    if (this._opcode === 0x08 && this._state == GET_INFO) return cb();

	    this._bufferedBytes += chunk.length;
	    this._buffers.push(chunk);
	    this.startLoop(cb);
	  }

	  /**
	   * Consumes `n` bytes from the buffered data.
	   *
	   * @param {Number} n The number of bytes to consume
	   * @return {Buffer} The consumed bytes
	   * @private
	   */
	  consume(n) {
	    this._bufferedBytes -= n;

	    if (n === this._buffers[0].length) return this._buffers.shift();

	    if (n < this._buffers[0].length) {
	      const buf = this._buffers[0];
	      this._buffers[0] = new FastBuffer(
	        buf.buffer,
	        buf.byteOffset + n,
	        buf.length - n
	      );

	      return new FastBuffer(buf.buffer, buf.byteOffset, n);
	    }

	    const dst = Buffer.allocUnsafe(n);

	    do {
	      const buf = this._buffers[0];
	      const offset = dst.length - n;

	      if (n >= buf.length) {
	        dst.set(this._buffers.shift(), offset);
	      } else {
	        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
	        this._buffers[0] = new FastBuffer(
	          buf.buffer,
	          buf.byteOffset + n,
	          buf.length - n
	        );
	      }

	      n -= buf.length;
	    } while (n > 0);

	    return dst;
	  }

	  /**
	   * Starts the parsing loop.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  startLoop(cb) {
	    this._loop = true;

	    do {
	      switch (this._state) {
	        case GET_INFO:
	          this.getInfo(cb);
	          break;
	        case GET_PAYLOAD_LENGTH_16:
	          this.getPayloadLength16(cb);
	          break;
	        case GET_PAYLOAD_LENGTH_64:
	          this.getPayloadLength64(cb);
	          break;
	        case GET_MASK:
	          this.getMask();
	          break;
	        case GET_DATA:
	          this.getData(cb);
	          break;
	        case INFLATING:
	        case DEFER_EVENT:
	          this._loop = false;
	          return;
	      }
	    } while (this._loop);

	    if (!this._errored) cb();
	  }

	  /**
	   * Reads the first two bytes of a frame.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getInfo(cb) {
	    if (this._bufferedBytes < 2) {
	      this._loop = false;
	      return;
	    }

	    const buf = this.consume(2);

	    if ((buf[0] & 0x30) !== 0x00) {
	      const error = this.createError(
	        RangeError,
	        'RSV2 and RSV3 must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_RSV_2_3'
	      );

	      cb(error);
	      return;
	    }

	    const compressed = (buf[0] & 0x40) === 0x40;

	    if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
	      const error = this.createError(
	        RangeError,
	        'RSV1 must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_RSV_1'
	      );

	      cb(error);
	      return;
	    }

	    this._fin = (buf[0] & 0x80) === 0x80;
	    this._opcode = buf[0] & 0x0f;
	    this._payloadLength = buf[1] & 0x7f;

	    if (this._opcode === 0x00) {
	      if (compressed) {
	        const error = this.createError(
	          RangeError,
	          'RSV1 must be clear',
	          true,
	          1002,
	          'WS_ERR_UNEXPECTED_RSV_1'
	        );

	        cb(error);
	        return;
	      }

	      if (!this._fragmented) {
	        const error = this.createError(
	          RangeError,
	          'invalid opcode 0',
	          true,
	          1002,
	          'WS_ERR_INVALID_OPCODE'
	        );

	        cb(error);
	        return;
	      }

	      this._opcode = this._fragmented;
	    } else if (this._opcode === 0x01 || this._opcode === 0x02) {
	      if (this._fragmented) {
	        const error = this.createError(
	          RangeError,
	          `invalid opcode ${this._opcode}`,
	          true,
	          1002,
	          'WS_ERR_INVALID_OPCODE'
	        );

	        cb(error);
	        return;
	      }

	      this._compressed = compressed;
	    } else if (this._opcode > 0x07 && this._opcode < 0x0b) {
	      if (!this._fin) {
	        const error = this.createError(
	          RangeError,
	          'FIN must be set',
	          true,
	          1002,
	          'WS_ERR_EXPECTED_FIN'
	        );

	        cb(error);
	        return;
	      }

	      if (compressed) {
	        const error = this.createError(
	          RangeError,
	          'RSV1 must be clear',
	          true,
	          1002,
	          'WS_ERR_UNEXPECTED_RSV_1'
	        );

	        cb(error);
	        return;
	      }

	      if (
	        this._payloadLength > 0x7d ||
	        (this._opcode === 0x08 && this._payloadLength === 1)
	      ) {
	        const error = this.createError(
	          RangeError,
	          `invalid payload length ${this._payloadLength}`,
	          true,
	          1002,
	          'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH'
	        );

	        cb(error);
	        return;
	      }
	    } else {
	      const error = this.createError(
	        RangeError,
	        `invalid opcode ${this._opcode}`,
	        true,
	        1002,
	        'WS_ERR_INVALID_OPCODE'
	      );

	      cb(error);
	      return;
	    }

	    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
	    this._masked = (buf[1] & 0x80) === 0x80;

	    if (this._isServer) {
	      if (!this._masked) {
	        const error = this.createError(
	          RangeError,
	          'MASK must be set',
	          true,
	          1002,
	          'WS_ERR_EXPECTED_MASK'
	        );

	        cb(error);
	        return;
	      }
	    } else if (this._masked) {
	      const error = this.createError(
	        RangeError,
	        'MASK must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_MASK'
	      );

	      cb(error);
	      return;
	    }

	    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
	    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
	    else this.haveLength(cb);
	  }

	  /**
	   * Gets extended payload length (7+16).
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getPayloadLength16(cb) {
	    if (this._bufferedBytes < 2) {
	      this._loop = false;
	      return;
	    }

	    this._payloadLength = this.consume(2).readUInt16BE(0);
	    this.haveLength(cb);
	  }

	  /**
	   * Gets extended payload length (7+64).
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getPayloadLength64(cb) {
	    if (this._bufferedBytes < 8) {
	      this._loop = false;
	      return;
	    }

	    const buf = this.consume(8);
	    const num = buf.readUInt32BE(0);

	    //
	    // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
	    // if payload length is greater than this number.
	    //
	    if (num > Math.pow(2, 53 - 32) - 1) {
	      const error = this.createError(
	        RangeError,
	        'Unsupported WebSocket frame: payload length > 2^53 - 1',
	        false,
	        1009,
	        'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH'
	      );

	      cb(error);
	      return;
	    }

	    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
	    this.haveLength(cb);
	  }

	  /**
	   * Payload length has been read.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  haveLength(cb) {
	    if (this._payloadLength && this._opcode < 0x08) {
	      this._totalPayloadLength += this._payloadLength;
	      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
	        const error = this.createError(
	          RangeError,
	          'Max payload size exceeded',
	          false,
	          1009,
	          'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
	        );

	        cb(error);
	        return;
	      }
	    }

	    if (this._masked) this._state = GET_MASK;
	    else this._state = GET_DATA;
	  }

	  /**
	   * Reads mask bytes.
	   *
	   * @private
	   */
	  getMask() {
	    if (this._bufferedBytes < 4) {
	      this._loop = false;
	      return;
	    }

	    this._mask = this.consume(4);
	    this._state = GET_DATA;
	  }

	  /**
	   * Reads data bytes.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getData(cb) {
	    let data = EMPTY_BUFFER;

	    if (this._payloadLength) {
	      if (this._bufferedBytes < this._payloadLength) {
	        this._loop = false;
	        return;
	      }

	      data = this.consume(this._payloadLength);

	      if (
	        this._masked &&
	        (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0
	      ) {
	        unmask(data, this._mask);
	      }
	    }

	    if (this._opcode > 0x07) {
	      this.controlMessage(data, cb);
	      return;
	    }

	    if (this._compressed) {
	      this._state = INFLATING;
	      this.decompress(data, cb);
	      return;
	    }

	    if (data.length) {
	      //
	      // This message is not compressed so its length is the sum of the payload
	      // length of all fragments.
	      //
	      this._messageLength = this._totalPayloadLength;
	      this._fragments.push(data);
	    }

	    this.dataMessage(cb);
	  }

	  /**
	   * Decompresses data.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Function} cb Callback
	   * @private
	   */
	  decompress(data, cb) {
	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

	    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
	      if (err) return cb(err);

	      if (buf.length) {
	        this._messageLength += buf.length;
	        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
	          const error = this.createError(
	            RangeError,
	            'Max payload size exceeded',
	            false,
	            1009,
	            'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
	          );

	          cb(error);
	          return;
	        }

	        this._fragments.push(buf);
	      }

	      this.dataMessage(cb);
	      if (this._state === GET_INFO) this.startLoop(cb);
	    });
	  }

	  /**
	   * Handles a data message.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  dataMessage(cb) {
	    if (!this._fin) {
	      this._state = GET_INFO;
	      return;
	    }

	    const messageLength = this._messageLength;
	    const fragments = this._fragments;

	    this._totalPayloadLength = 0;
	    this._messageLength = 0;
	    this._fragmented = 0;
	    this._fragments = [];

	    if (this._opcode === 2) {
	      let data;

	      if (this._binaryType === 'nodebuffer') {
	        data = concat(fragments, messageLength);
	      } else if (this._binaryType === 'arraybuffer') {
	        data = toArrayBuffer(concat(fragments, messageLength));
	      } else if (this._binaryType === 'blob') {
	        data = new Blob(fragments);
	      } else {
	        data = fragments;
	      }

	      if (this._allowSynchronousEvents) {
	        this.emit('message', data, true);
	        this._state = GET_INFO;
	      } else {
	        this._state = DEFER_EVENT;
	        setImmediate(() => {
	          this.emit('message', data, true);
	          this._state = GET_INFO;
	          this.startLoop(cb);
	        });
	      }
	    } else {
	      const buf = concat(fragments, messageLength);

	      if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
	        const error = this.createError(
	          Error,
	          'invalid UTF-8 sequence',
	          true,
	          1007,
	          'WS_ERR_INVALID_UTF8'
	        );

	        cb(error);
	        return;
	      }

	      if (this._state === INFLATING || this._allowSynchronousEvents) {
	        this.emit('message', buf, false);
	        this._state = GET_INFO;
	      } else {
	        this._state = DEFER_EVENT;
	        setImmediate(() => {
	          this.emit('message', buf, false);
	          this._state = GET_INFO;
	          this.startLoop(cb);
	        });
	      }
	    }
	  }

	  /**
	   * Handles a control message.
	   *
	   * @param {Buffer} data Data to handle
	   * @return {(Error|RangeError|undefined)} A possible error
	   * @private
	   */
	  controlMessage(data, cb) {
	    if (this._opcode === 0x08) {
	      if (data.length === 0) {
	        this._loop = false;
	        this.emit('conclude', 1005, EMPTY_BUFFER);
	        this.end();
	      } else {
	        const code = data.readUInt16BE(0);

	        if (!isValidStatusCode(code)) {
	          const error = this.createError(
	            RangeError,
	            `invalid status code ${code}`,
	            true,
	            1002,
	            'WS_ERR_INVALID_CLOSE_CODE'
	          );

	          cb(error);
	          return;
	        }

	        const buf = new FastBuffer(
	          data.buffer,
	          data.byteOffset + 2,
	          data.length - 2
	        );

	        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
	          const error = this.createError(
	            Error,
	            'invalid UTF-8 sequence',
	            true,
	            1007,
	            'WS_ERR_INVALID_UTF8'
	          );

	          cb(error);
	          return;
	        }

	        this._loop = false;
	        this.emit('conclude', code, buf);
	        this.end();
	      }

	      this._state = GET_INFO;
	      return;
	    }

	    if (this._allowSynchronousEvents) {
	      this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
	      this._state = GET_INFO;
	    } else {
	      this._state = DEFER_EVENT;
	      setImmediate(() => {
	        this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
	        this._state = GET_INFO;
	        this.startLoop(cb);
	      });
	    }
	  }

	  /**
	   * Builds an error object.
	   *
	   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
	   * @param {String} message The error message
	   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
	   *     `message`
	   * @param {Number} statusCode The status code
	   * @param {String} errorCode The exposed error code
	   * @return {(Error|RangeError)} The error
	   * @private
	   */
	  createError(ErrorCtor, message, prefix, statusCode, errorCode) {
	    this._loop = false;
	    this._errored = true;

	    const err = new ErrorCtor(
	      prefix ? `Invalid WebSocket frame: ${message}` : message
	    );

	    Error.captureStackTrace(err, this.createError);
	    err.code = errorCode;
	    err[kStatusCode] = statusCode;
	    return err;
	  }
	}

	receiver = Receiver;
	return receiver;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex" }] */

var sender;
var hasRequiredSender;

function requireSender () {
	if (hasRequiredSender) return sender;
	hasRequiredSender = 1;

	const { Duplex } = require$$0$2;
	const { randomFillSync } = require$$1;

	const PerMessageDeflate = requirePermessageDeflate();
	const { EMPTY_BUFFER, kWebSocket, NOOP } = requireConstants();
	const { isBlob, isValidStatusCode } = requireValidation();
	const { mask: applyMask, toBuffer } = requireBufferUtil();

	const kByteLength = Symbol('kByteLength');
	const maskBuffer = Buffer.alloc(4);
	const RANDOM_POOL_SIZE = 8 * 1024;
	let randomPool;
	let randomPoolPointer = RANDOM_POOL_SIZE;

	const DEFAULT = 0;
	const DEFLATING = 1;
	const GET_BLOB_DATA = 2;

	/**
	 * HyBi Sender implementation.
	 */
	class Sender {
	  /**
	   * Creates a Sender instance.
	   *
	   * @param {Duplex} socket The connection socket
	   * @param {Object} [extensions] An object containing the negotiated extensions
	   * @param {Function} [generateMask] The function used to generate the masking
	   *     key
	   */
	  constructor(socket, extensions, generateMask) {
	    this._extensions = extensions || {};

	    if (generateMask) {
	      this._generateMask = generateMask;
	      this._maskBuffer = Buffer.alloc(4);
	    }

	    this._socket = socket;

	    this._firstFragment = true;
	    this._compress = false;

	    this._bufferedBytes = 0;
	    this._queue = [];
	    this._state = DEFAULT;
	    this.onerror = NOOP;
	    this[kWebSocket] = undefined;
	  }

	  /**
	   * Frames a piece of data according to the HyBi WebSocket protocol.
	   *
	   * @param {(Buffer|String)} data The data to frame
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @return {(Buffer|String)[]} The framed data
	   * @public
	   */
	  static frame(data, options) {
	    let mask;
	    let merge = false;
	    let offset = 2;
	    let skipMasking = false;

	    if (options.mask) {
	      mask = options.maskBuffer || maskBuffer;

	      if (options.generateMask) {
	        options.generateMask(mask);
	      } else {
	        if (randomPoolPointer === RANDOM_POOL_SIZE) {
	          /* istanbul ignore else  */
	          if (randomPool === undefined) {
	            //
	            // This is lazily initialized because server-sent frames must not
	            // be masked so it may never be used.
	            //
	            randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
	          }

	          randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
	          randomPoolPointer = 0;
	        }

	        mask[0] = randomPool[randomPoolPointer++];
	        mask[1] = randomPool[randomPoolPointer++];
	        mask[2] = randomPool[randomPoolPointer++];
	        mask[3] = randomPool[randomPoolPointer++];
	      }

	      skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
	      offset = 6;
	    }

	    let dataLength;

	    if (typeof data === 'string') {
	      if (
	        (!options.mask || skipMasking) &&
	        options[kByteLength] !== undefined
	      ) {
	        dataLength = options[kByteLength];
	      } else {
	        data = Buffer.from(data);
	        dataLength = data.length;
	      }
	    } else {
	      dataLength = data.length;
	      merge = options.mask && options.readOnly && !skipMasking;
	    }

	    let payloadLength = dataLength;

	    if (dataLength >= 65536) {
	      offset += 8;
	      payloadLength = 127;
	    } else if (dataLength > 125) {
	      offset += 2;
	      payloadLength = 126;
	    }

	    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);

	    target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
	    if (options.rsv1) target[0] |= 0x40;

	    target[1] = payloadLength;

	    if (payloadLength === 126) {
	      target.writeUInt16BE(dataLength, 2);
	    } else if (payloadLength === 127) {
	      target[2] = target[3] = 0;
	      target.writeUIntBE(dataLength, 4, 6);
	    }

	    if (!options.mask) return [target, data];

	    target[1] |= 0x80;
	    target[offset - 4] = mask[0];
	    target[offset - 3] = mask[1];
	    target[offset - 2] = mask[2];
	    target[offset - 1] = mask[3];

	    if (skipMasking) return [target, data];

	    if (merge) {
	      applyMask(data, mask, target, offset, dataLength);
	      return [target];
	    }

	    applyMask(data, mask, data, 0, dataLength);
	    return [target, data];
	  }

	  /**
	   * Sends a close message to the other peer.
	   *
	   * @param {Number} [code] The status code component of the body
	   * @param {(String|Buffer)} [data] The message component of the body
	   * @param {Boolean} [mask=false] Specifies whether or not to mask the message
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  close(code, data, mask, cb) {
	    let buf;

	    if (code === undefined) {
	      buf = EMPTY_BUFFER;
	    } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
	      throw new TypeError('First argument must be a valid error code number');
	    } else if (data === undefined || !data.length) {
	      buf = Buffer.allocUnsafe(2);
	      buf.writeUInt16BE(code, 0);
	    } else {
	      const length = Buffer.byteLength(data);

	      if (length > 123) {
	        throw new RangeError('The message must not be greater than 123 bytes');
	      }

	      buf = Buffer.allocUnsafe(2 + length);
	      buf.writeUInt16BE(code, 0);

	      if (typeof data === 'string') {
	        buf.write(data, 2);
	      } else {
	        buf.set(data, 2);
	      }
	    }

	    const options = {
	      [kByteLength]: buf.length,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x08,
	      readOnly: false,
	      rsv1: false
	    };

	    if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, buf, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(buf, options), cb);
	    }
	  }

	  /**
	   * Sends a ping message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  ping(data, mask, cb) {
	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (byteLength > 125) {
	      throw new RangeError('The data size must not be greater than 125 bytes');
	    }

	    const options = {
	      [kByteLength]: byteLength,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x09,
	      readOnly,
	      rsv1: false
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, false, options, cb]);
	      } else {
	        this.getBlobData(data, false, options, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(data, options), cb);
	    }
	  }

	  /**
	   * Sends a pong message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  pong(data, mask, cb) {
	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (byteLength > 125) {
	      throw new RangeError('The data size must not be greater than 125 bytes');
	    }

	    const options = {
	      [kByteLength]: byteLength,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x0a,
	      readOnly,
	      rsv1: false
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, false, options, cb]);
	      } else {
	        this.getBlobData(data, false, options, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(data, options), cb);
	    }
	  }

	  /**
	   * Sends a data message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Object} options Options object
	   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
	   *     or text
	   * @param {Boolean} [options.compress=false] Specifies whether or not to
	   *     compress `data`
	   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
	   *     last one
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  send(data, options, cb) {
	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
	    let opcode = options.binary ? 2 : 1;
	    let rsv1 = options.compress;

	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (this._firstFragment) {
	      this._firstFragment = false;
	      if (
	        rsv1 &&
	        perMessageDeflate &&
	        perMessageDeflate.params[
	          perMessageDeflate._isServer
	            ? 'server_no_context_takeover'
	            : 'client_no_context_takeover'
	        ]
	      ) {
	        rsv1 = byteLength >= perMessageDeflate._threshold;
	      }
	      this._compress = rsv1;
	    } else {
	      rsv1 = false;
	      opcode = 0;
	    }

	    if (options.fin) this._firstFragment = true;

	    const opts = {
	      [kByteLength]: byteLength,
	      fin: options.fin,
	      generateMask: this._generateMask,
	      mask: options.mask,
	      maskBuffer: this._maskBuffer,
	      opcode,
	      readOnly,
	      rsv1
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
	      } else {
	        this.getBlobData(data, this._compress, opts, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, this._compress, opts, cb]);
	    } else {
	      this.dispatch(data, this._compress, opts, cb);
	    }
	  }

	  /**
	   * Gets the contents of a blob as binary data.
	   *
	   * @param {Blob} blob The blob
	   * @param {Boolean} [compress=false] Specifies whether or not to compress
	   *     the data
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  getBlobData(blob, compress, options, cb) {
	    this._bufferedBytes += options[kByteLength];
	    this._state = GET_BLOB_DATA;

	    blob
	      .arrayBuffer()
	      .then((arrayBuffer) => {
	        if (this._socket.destroyed) {
	          const err = new Error(
	            'The socket was closed while the blob was being read'
	          );

	          //
	          // `callCallbacks` is called in the next tick to ensure that errors
	          // that might be thrown in the callbacks behave like errors thrown
	          // outside the promise chain.
	          //
	          process.nextTick(callCallbacks, this, err, cb);
	          return;
	        }

	        this._bufferedBytes -= options[kByteLength];
	        const data = toBuffer(arrayBuffer);

	        if (!compress) {
	          this._state = DEFAULT;
	          this.sendFrame(Sender.frame(data, options), cb);
	          this.dequeue();
	        } else {
	          this.dispatch(data, compress, options, cb);
	        }
	      })
	      .catch((err) => {
	        //
	        // `onError` is called in the next tick for the same reason that
	        // `callCallbacks` above is.
	        //
	        process.nextTick(onError, this, err, cb);
	      });
	  }

	  /**
	   * Dispatches a message.
	   *
	   * @param {(Buffer|String)} data The message to send
	   * @param {Boolean} [compress=false] Specifies whether or not to compress
	   *     `data`
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  dispatch(data, compress, options, cb) {
	    if (!compress) {
	      this.sendFrame(Sender.frame(data, options), cb);
	      return;
	    }

	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

	    this._bufferedBytes += options[kByteLength];
	    this._state = DEFLATING;
	    perMessageDeflate.compress(data, options.fin, (_, buf) => {
	      if (this._socket.destroyed) {
	        const err = new Error(
	          'The socket was closed while data was being compressed'
	        );

	        callCallbacks(this, err, cb);
	        return;
	      }

	      this._bufferedBytes -= options[kByteLength];
	      this._state = DEFAULT;
	      options.readOnly = false;
	      this.sendFrame(Sender.frame(buf, options), cb);
	      this.dequeue();
	    });
	  }

	  /**
	   * Executes queued send operations.
	   *
	   * @private
	   */
	  dequeue() {
	    while (this._state === DEFAULT && this._queue.length) {
	      const params = this._queue.shift();

	      this._bufferedBytes -= params[3][kByteLength];
	      Reflect.apply(params[0], this, params.slice(1));
	    }
	  }

	  /**
	   * Enqueues a send operation.
	   *
	   * @param {Array} params Send operation parameters.
	   * @private
	   */
	  enqueue(params) {
	    this._bufferedBytes += params[3][kByteLength];
	    this._queue.push(params);
	  }

	  /**
	   * Sends a frame.
	   *
	   * @param {(Buffer | String)[]} list The frame to send
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  sendFrame(list, cb) {
	    if (list.length === 2) {
	      this._socket.cork();
	      this._socket.write(list[0]);
	      this._socket.write(list[1], cb);
	      this._socket.uncork();
	    } else {
	      this._socket.write(list[0], cb);
	    }
	  }
	}

	sender = Sender;

	/**
	 * Calls queued callbacks with an error.
	 *
	 * @param {Sender} sender The `Sender` instance
	 * @param {Error} err The error to call the callbacks with
	 * @param {Function} [cb] The first callback
	 * @private
	 */
	function callCallbacks(sender, err, cb) {
	  if (typeof cb === 'function') cb(err);

	  for (let i = 0; i < sender._queue.length; i++) {
	    const params = sender._queue[i];
	    const callback = params[params.length - 1];

	    if (typeof callback === 'function') callback(err);
	  }
	}

	/**
	 * Handles a `Sender` error.
	 *
	 * @param {Sender} sender The `Sender` instance
	 * @param {Error} err The error
	 * @param {Function} [cb] The first pending callback
	 * @private
	 */
	function onError(sender, err, cb) {
	  callCallbacks(sender, err, cb);
	  sender.onerror(err);
	}
	return sender;
}

var eventTarget;
var hasRequiredEventTarget;

function requireEventTarget () {
	if (hasRequiredEventTarget) return eventTarget;
	hasRequiredEventTarget = 1;

	const { kForOnEventAttribute, kListener } = requireConstants();

	const kCode = Symbol('kCode');
	const kData = Symbol('kData');
	const kError = Symbol('kError');
	const kMessage = Symbol('kMessage');
	const kReason = Symbol('kReason');
	const kTarget = Symbol('kTarget');
	const kType = Symbol('kType');
	const kWasClean = Symbol('kWasClean');

	/**
	 * Class representing an event.
	 */
	class Event {
	  /**
	   * Create a new `Event`.
	   *
	   * @param {String} type The name of the event
	   * @throws {TypeError} If the `type` argument is not specified
	   */
	  constructor(type) {
	    this[kTarget] = null;
	    this[kType] = type;
	  }

	  /**
	   * @type {*}
	   */
	  get target() {
	    return this[kTarget];
	  }

	  /**
	   * @type {String}
	   */
	  get type() {
	    return this[kType];
	  }
	}

	Object.defineProperty(Event.prototype, 'target', { enumerable: true });
	Object.defineProperty(Event.prototype, 'type', { enumerable: true });

	/**
	 * Class representing a close event.
	 *
	 * @extends Event
	 */
	class CloseEvent extends Event {
	  /**
	   * Create a new `CloseEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {Number} [options.code=0] The status code explaining why the
	   *     connection was closed
	   * @param {String} [options.reason=''] A human-readable string explaining why
	   *     the connection was closed
	   * @param {Boolean} [options.wasClean=false] Indicates whether or not the
	   *     connection was cleanly closed
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kCode] = options.code === undefined ? 0 : options.code;
	    this[kReason] = options.reason === undefined ? '' : options.reason;
	    this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
	  }

	  /**
	   * @type {Number}
	   */
	  get code() {
	    return this[kCode];
	  }

	  /**
	   * @type {String}
	   */
	  get reason() {
	    return this[kReason];
	  }

	  /**
	   * @type {Boolean}
	   */
	  get wasClean() {
	    return this[kWasClean];
	  }
	}

	Object.defineProperty(CloseEvent.prototype, 'code', { enumerable: true });
	Object.defineProperty(CloseEvent.prototype, 'reason', { enumerable: true });
	Object.defineProperty(CloseEvent.prototype, 'wasClean', { enumerable: true });

	/**
	 * Class representing an error event.
	 *
	 * @extends Event
	 */
	class ErrorEvent extends Event {
	  /**
	   * Create a new `ErrorEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {*} [options.error=null] The error that generated this event
	   * @param {String} [options.message=''] The error message
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kError] = options.error === undefined ? null : options.error;
	    this[kMessage] = options.message === undefined ? '' : options.message;
	  }

	  /**
	   * @type {*}
	   */
	  get error() {
	    return this[kError];
	  }

	  /**
	   * @type {String}
	   */
	  get message() {
	    return this[kMessage];
	  }
	}

	Object.defineProperty(ErrorEvent.prototype, 'error', { enumerable: true });
	Object.defineProperty(ErrorEvent.prototype, 'message', { enumerable: true });

	/**
	 * Class representing a message event.
	 *
	 * @extends Event
	 */
	class MessageEvent extends Event {
	  /**
	   * Create a new `MessageEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {*} [options.data=null] The message content
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kData] = options.data === undefined ? null : options.data;
	  }

	  /**
	   * @type {*}
	   */
	  get data() {
	    return this[kData];
	  }
	}

	Object.defineProperty(MessageEvent.prototype, 'data', { enumerable: true });

	/**
	 * This provides methods for emulating the `EventTarget` interface. It's not
	 * meant to be used directly.
	 *
	 * @mixin
	 */
	const EventTarget = {
	  /**
	   * Register an event listener.
	   *
	   * @param {String} type A string representing the event type to listen for
	   * @param {(Function|Object)} handler The listener to add
	   * @param {Object} [options] An options object specifies characteristics about
	   *     the event listener
	   * @param {Boolean} [options.once=false] A `Boolean` indicating that the
	   *     listener should be invoked at most once after being added. If `true`,
	   *     the listener would be automatically removed when invoked.
	   * @public
	   */
	  addEventListener(type, handler, options = {}) {
	    for (const listener of this.listeners(type)) {
	      if (
	        !options[kForOnEventAttribute] &&
	        listener[kListener] === handler &&
	        !listener[kForOnEventAttribute]
	      ) {
	        return;
	      }
	    }

	    let wrapper;

	    if (type === 'message') {
	      wrapper = function onMessage(data, isBinary) {
	        const event = new MessageEvent('message', {
	          data: isBinary ? data : data.toString()
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'close') {
	      wrapper = function onClose(code, message) {
	        const event = new CloseEvent('close', {
	          code,
	          reason: message.toString(),
	          wasClean: this._closeFrameReceived && this._closeFrameSent
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'error') {
	      wrapper = function onError(error) {
	        const event = new ErrorEvent('error', {
	          error,
	          message: error.message
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'open') {
	      wrapper = function onOpen() {
	        const event = new Event('open');

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else {
	      return;
	    }

	    wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
	    wrapper[kListener] = handler;

	    if (options.once) {
	      this.once(type, wrapper);
	    } else {
	      this.on(type, wrapper);
	    }
	  },

	  /**
	   * Remove an event listener.
	   *
	   * @param {String} type A string representing the event type to remove
	   * @param {(Function|Object)} handler The listener to remove
	   * @public
	   */
	  removeEventListener(type, handler) {
	    for (const listener of this.listeners(type)) {
	      if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
	        this.removeListener(type, listener);
	        break;
	      }
	    }
	  }
	};

	eventTarget = {
	  CloseEvent,
	  ErrorEvent,
	  Event,
	  EventTarget,
	  MessageEvent
	};

	/**
	 * Call an event listener
	 *
	 * @param {(Function|Object)} listener The listener to call
	 * @param {*} thisArg The value to use as `this`` when calling the listener
	 * @param {Event} event The event to pass to the listener
	 * @private
	 */
	function callListener(listener, thisArg, event) {
	  if (typeof listener === 'object' && listener.handleEvent) {
	    listener.handleEvent.call(listener, event);
	  } else {
	    listener.call(thisArg, event);
	  }
	}
	return eventTarget;
}

var extension;
var hasRequiredExtension;

function requireExtension () {
	if (hasRequiredExtension) return extension;
	hasRequiredExtension = 1;

	const { tokenChars } = requireValidation();

	/**
	 * Adds an offer to the map of extension offers or a parameter to the map of
	 * parameters.
	 *
	 * @param {Object} dest The map of extension offers or parameters
	 * @param {String} name The extension or parameter name
	 * @param {(Object|Boolean|String)} elem The extension parameters or the
	 *     parameter value
	 * @private
	 */
	function push(dest, name, elem) {
	  if (dest[name] === undefined) dest[name] = [elem];
	  else dest[name].push(elem);
	}

	/**
	 * Parses the `Sec-WebSocket-Extensions` header into an object.
	 *
	 * @param {String} header The field value of the header
	 * @return {Object} The parsed object
	 * @public
	 */
	function parse(header) {
	  const offers = Object.create(null);
	  let params = Object.create(null);
	  let mustUnescape = false;
	  let isEscaping = false;
	  let inQuotes = false;
	  let extensionName;
	  let paramName;
	  let start = -1;
	  let code = -1;
	  let end = -1;
	  let i = 0;

	  for (; i < header.length; i++) {
	    code = header.charCodeAt(i);

	    if (extensionName === undefined) {
	      if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (
	        i !== 0 &&
	        (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
	      ) {
	        if (end === -1 && start !== -1) end = i;
	      } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        const name = header.slice(start, end);
	        if (code === 0x2c) {
	          push(offers, name, params);
	          params = Object.create(null);
	        } else {
	          extensionName = name;
	        }

	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    } else if (paramName === undefined) {
	      if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (code === 0x20 || code === 0x09) {
	        if (end === -1 && start !== -1) end = i;
	      } else if (code === 0x3b || code === 0x2c) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        push(params, header.slice(start, end), true);
	        if (code === 0x2c) {
	          push(offers, extensionName, params);
	          params = Object.create(null);
	          extensionName = undefined;
	        }

	        start = end = -1;
	      } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
	        paramName = header.slice(start, i);
	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    } else {
	      //
	      // The value of a quoted-string after unescaping must conform to the
	      // token ABNF, so only token characters are valid.
	      // Ref: https://tools.ietf.org/html/rfc6455#section-9.1
	      //
	      if (isEscaping) {
	        if (tokenChars[code] !== 1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }
	        if (start === -1) start = i;
	        else if (!mustUnescape) mustUnescape = true;
	        isEscaping = false;
	      } else if (inQuotes) {
	        if (tokenChars[code] === 1) {
	          if (start === -1) start = i;
	        } else if (code === 0x22 /* '"' */ && start !== -1) {
	          inQuotes = false;
	          end = i;
	        } else if (code === 0x5c /* '\' */) {
	          isEscaping = true;
	        } else {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }
	      } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
	        inQuotes = true;
	      } else if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
	        if (end === -1) end = i;
	      } else if (code === 0x3b || code === 0x2c) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        let value = header.slice(start, end);
	        if (mustUnescape) {
	          value = value.replace(/\\/g, '');
	          mustUnescape = false;
	        }
	        push(params, paramName, value);
	        if (code === 0x2c) {
	          push(offers, extensionName, params);
	          params = Object.create(null);
	          extensionName = undefined;
	        }

	        paramName = undefined;
	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    }
	  }

	  if (start === -1 || inQuotes || code === 0x20 || code === 0x09) {
	    throw new SyntaxError('Unexpected end of input');
	  }

	  if (end === -1) end = i;
	  const token = header.slice(start, end);
	  if (extensionName === undefined) {
	    push(offers, token, params);
	  } else {
	    if (paramName === undefined) {
	      push(params, token, true);
	    } else if (mustUnescape) {
	      push(params, paramName, token.replace(/\\/g, ''));
	    } else {
	      push(params, paramName, token);
	    }
	    push(offers, extensionName, params);
	  }

	  return offers;
	}

	/**
	 * Builds the `Sec-WebSocket-Extensions` header field value.
	 *
	 * @param {Object} extensions The map of extensions and parameters to format
	 * @return {String} A string representing the given object
	 * @public
	 */
	function format(extensions) {
	  return Object.keys(extensions)
	    .map((extension) => {
	      let configurations = extensions[extension];
	      if (!Array.isArray(configurations)) configurations = [configurations];
	      return configurations
	        .map((params) => {
	          return [extension]
	            .concat(
	              Object.keys(params).map((k) => {
	                let values = params[k];
	                if (!Array.isArray(values)) values = [values];
	                return values
	                  .map((v) => (v === true ? k : `${k}=${v}`))
	                  .join('; ');
	              })
	            )
	            .join('; ');
	        })
	        .join(', ');
	    })
	    .join(', ');
	}

	extension = { format, parse };
	return extension;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex|Readable$", "caughtErrors": "none" }] */

var websocket;
var hasRequiredWebsocket;

function requireWebsocket () {
	if (hasRequiredWebsocket) return websocket;
	hasRequiredWebsocket = 1;

	const EventEmitter = require$$0$3;
	const https = require$$1$1;
	const http = require$$2;
	const net = require$$3;
	const tls = require$$4;
	const { randomBytes, createHash } = require$$1;
	const { Duplex, Readable } = require$$0$2;
	const { URL } = require$$7;

	const PerMessageDeflate = requirePermessageDeflate();
	const Receiver = requireReceiver();
	const Sender = requireSender();
	const { isBlob } = requireValidation();

	const {
	  BINARY_TYPES,
	  EMPTY_BUFFER,
	  GUID,
	  kForOnEventAttribute,
	  kListener,
	  kStatusCode,
	  kWebSocket,
	  NOOP
	} = requireConstants();
	const {
	  EventTarget: { addEventListener, removeEventListener }
	} = requireEventTarget();
	const { format, parse } = requireExtension();
	const { toBuffer } = requireBufferUtil();

	const closeTimeout = 30 * 1000;
	const kAborted = Symbol('kAborted');
	const protocolVersions = [8, 13];
	const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
	const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

	/**
	 * Class representing a WebSocket.
	 *
	 * @extends EventEmitter
	 */
	class WebSocket extends EventEmitter {
	  /**
	   * Create a new `WebSocket`.
	   *
	   * @param {(String|URL)} address The URL to which to connect
	   * @param {(String|String[])} [protocols] The subprotocols
	   * @param {Object} [options] Connection options
	   */
	  constructor(address, protocols, options) {
	    super();

	    this._binaryType = BINARY_TYPES[0];
	    this._closeCode = 1006;
	    this._closeFrameReceived = false;
	    this._closeFrameSent = false;
	    this._closeMessage = EMPTY_BUFFER;
	    this._closeTimer = null;
	    this._errorEmitted = false;
	    this._extensions = {};
	    this._paused = false;
	    this._protocol = '';
	    this._readyState = WebSocket.CONNECTING;
	    this._receiver = null;
	    this._sender = null;
	    this._socket = null;

	    if (address !== null) {
	      this._bufferedAmount = 0;
	      this._isServer = false;
	      this._redirects = 0;

	      if (protocols === undefined) {
	        protocols = [];
	      } else if (!Array.isArray(protocols)) {
	        if (typeof protocols === 'object' && protocols !== null) {
	          options = protocols;
	          protocols = [];
	        } else {
	          protocols = [protocols];
	        }
	      }

	      initAsClient(this, address, protocols, options);
	    } else {
	      this._autoPong = options.autoPong;
	      this._isServer = true;
	    }
	  }

	  /**
	   * For historical reasons, the custom "nodebuffer" type is used by the default
	   * instead of "blob".
	   *
	   * @type {String}
	   */
	  get binaryType() {
	    return this._binaryType;
	  }

	  set binaryType(type) {
	    if (!BINARY_TYPES.includes(type)) return;

	    this._binaryType = type;

	    //
	    // Allow to change `binaryType` on the fly.
	    //
	    if (this._receiver) this._receiver._binaryType = type;
	  }

	  /**
	   * @type {Number}
	   */
	  get bufferedAmount() {
	    if (!this._socket) return this._bufferedAmount;

	    return this._socket._writableState.length + this._sender._bufferedBytes;
	  }

	  /**
	   * @type {String}
	   */
	  get extensions() {
	    return Object.keys(this._extensions).join();
	  }

	  /**
	   * @type {Boolean}
	   */
	  get isPaused() {
	    return this._paused;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onclose() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onerror() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onopen() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onmessage() {
	    return null;
	  }

	  /**
	   * @type {String}
	   */
	  get protocol() {
	    return this._protocol;
	  }

	  /**
	   * @type {Number}
	   */
	  get readyState() {
	    return this._readyState;
	  }

	  /**
	   * @type {String}
	   */
	  get url() {
	    return this._url;
	  }

	  /**
	   * Set up the socket and the internal resources.
	   *
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Object} options Options object
	   * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Number} [options.maxPayload=0] The maximum allowed message size
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   * @private
	   */
	  setSocket(socket, head, options) {
	    const receiver = new Receiver({
	      allowSynchronousEvents: options.allowSynchronousEvents,
	      binaryType: this.binaryType,
	      extensions: this._extensions,
	      isServer: this._isServer,
	      maxPayload: options.maxPayload,
	      skipUTF8Validation: options.skipUTF8Validation
	    });

	    const sender = new Sender(socket, this._extensions, options.generateMask);

	    this._receiver = receiver;
	    this._sender = sender;
	    this._socket = socket;

	    receiver[kWebSocket] = this;
	    sender[kWebSocket] = this;
	    socket[kWebSocket] = this;

	    receiver.on('conclude', receiverOnConclude);
	    receiver.on('drain', receiverOnDrain);
	    receiver.on('error', receiverOnError);
	    receiver.on('message', receiverOnMessage);
	    receiver.on('ping', receiverOnPing);
	    receiver.on('pong', receiverOnPong);

	    sender.onerror = senderOnError;

	    //
	    // These methods may not be available if `socket` is just a `Duplex`.
	    //
	    if (socket.setTimeout) socket.setTimeout(0);
	    if (socket.setNoDelay) socket.setNoDelay();

	    if (head.length > 0) socket.unshift(head);

	    socket.on('close', socketOnClose);
	    socket.on('data', socketOnData);
	    socket.on('end', socketOnEnd);
	    socket.on('error', socketOnError);

	    this._readyState = WebSocket.OPEN;
	    this.emit('open');
	  }

	  /**
	   * Emit the `'close'` event.
	   *
	   * @private
	   */
	  emitClose() {
	    if (!this._socket) {
	      this._readyState = WebSocket.CLOSED;
	      this.emit('close', this._closeCode, this._closeMessage);
	      return;
	    }

	    if (this._extensions[PerMessageDeflate.extensionName]) {
	      this._extensions[PerMessageDeflate.extensionName].cleanup();
	    }

	    this._receiver.removeAllListeners();
	    this._readyState = WebSocket.CLOSED;
	    this.emit('close', this._closeCode, this._closeMessage);
	  }

	  /**
	   * Start a closing handshake.
	   *
	   *          +----------+   +-----------+   +----------+
	   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
	   *    |     +----------+   +-----------+   +----------+     |
	   *          +----------+   +-----------+         |
	   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
	   *          +----------+   +-----------+   |
	   *    |           |                        |   +---+        |
	   *                +------------------------+-->|fin| - - - -
	   *    |         +---+                      |   +---+
	   *     - - - - -|fin|<---------------------+
	   *              +---+
	   *
	   * @param {Number} [code] Status code explaining why the connection is closing
	   * @param {(String|Buffer)} [data] The reason why the connection is
	   *     closing
	   * @public
	   */
	  close(code, data) {
	    if (this.readyState === WebSocket.CLOSED) return;
	    if (this.readyState === WebSocket.CONNECTING) {
	      const msg = 'WebSocket was closed before the connection was established';
	      abortHandshake(this, this._req, msg);
	      return;
	    }

	    if (this.readyState === WebSocket.CLOSING) {
	      if (
	        this._closeFrameSent &&
	        (this._closeFrameReceived || this._receiver._writableState.errorEmitted)
	      ) {
	        this._socket.end();
	      }

	      return;
	    }

	    this._readyState = WebSocket.CLOSING;
	    this._sender.close(code, data, !this._isServer, (err) => {
	      //
	      // This error is handled by the `'error'` listener on the socket. We only
	      // want to know if the close frame has been sent here.
	      //
	      if (err) return;

	      this._closeFrameSent = true;

	      if (
	        this._closeFrameReceived ||
	        this._receiver._writableState.errorEmitted
	      ) {
	        this._socket.end();
	      }
	    });

	    setCloseTimer(this);
	  }

	  /**
	   * Pause the socket.
	   *
	   * @public
	   */
	  pause() {
	    if (
	      this.readyState === WebSocket.CONNECTING ||
	      this.readyState === WebSocket.CLOSED
	    ) {
	      return;
	    }

	    this._paused = true;
	    this._socket.pause();
	  }

	  /**
	   * Send a ping.
	   *
	   * @param {*} [data] The data to send
	   * @param {Boolean} [mask] Indicates whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when the ping is sent
	   * @public
	   */
	  ping(data, mask, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof data === 'function') {
	      cb = data;
	      data = mask = undefined;
	    } else if (typeof mask === 'function') {
	      cb = mask;
	      mask = undefined;
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    if (mask === undefined) mask = !this._isServer;
	    this._sender.ping(data || EMPTY_BUFFER, mask, cb);
	  }

	  /**
	   * Send a pong.
	   *
	   * @param {*} [data] The data to send
	   * @param {Boolean} [mask] Indicates whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when the pong is sent
	   * @public
	   */
	  pong(data, mask, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof data === 'function') {
	      cb = data;
	      data = mask = undefined;
	    } else if (typeof mask === 'function') {
	      cb = mask;
	      mask = undefined;
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    if (mask === undefined) mask = !this._isServer;
	    this._sender.pong(data || EMPTY_BUFFER, mask, cb);
	  }

	  /**
	   * Resume the socket.
	   *
	   * @public
	   */
	  resume() {
	    if (
	      this.readyState === WebSocket.CONNECTING ||
	      this.readyState === WebSocket.CLOSED
	    ) {
	      return;
	    }

	    this._paused = false;
	    if (!this._receiver._writableState.needDrain) this._socket.resume();
	  }

	  /**
	   * Send a data message.
	   *
	   * @param {*} data The message to send
	   * @param {Object} [options] Options object
	   * @param {Boolean} [options.binary] Specifies whether `data` is binary or
	   *     text
	   * @param {Boolean} [options.compress] Specifies whether or not to compress
	   *     `data`
	   * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
	   *     last one
	   * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when data is written out
	   * @public
	   */
	  send(data, options, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof options === 'function') {
	      cb = options;
	      options = {};
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    const opts = {
	      binary: typeof data !== 'string',
	      mask: !this._isServer,
	      compress: true,
	      fin: true,
	      ...options
	    };

	    if (!this._extensions[PerMessageDeflate.extensionName]) {
	      opts.compress = false;
	    }

	    this._sender.send(data || EMPTY_BUFFER, opts, cb);
	  }

	  /**
	   * Forcibly close the connection.
	   *
	   * @public
	   */
	  terminate() {
	    if (this.readyState === WebSocket.CLOSED) return;
	    if (this.readyState === WebSocket.CONNECTING) {
	      const msg = 'WebSocket was closed before the connection was established';
	      abortHandshake(this, this._req, msg);
	      return;
	    }

	    if (this._socket) {
	      this._readyState = WebSocket.CLOSING;
	      this._socket.destroy();
	    }
	  }
	}

	/**
	 * @constant {Number} CONNECTING
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CONNECTING', {
	  enumerable: true,
	  value: readyStates.indexOf('CONNECTING')
	});

	/**
	 * @constant {Number} CONNECTING
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CONNECTING', {
	  enumerable: true,
	  value: readyStates.indexOf('CONNECTING')
	});

	/**
	 * @constant {Number} OPEN
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'OPEN', {
	  enumerable: true,
	  value: readyStates.indexOf('OPEN')
	});

	/**
	 * @constant {Number} OPEN
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'OPEN', {
	  enumerable: true,
	  value: readyStates.indexOf('OPEN')
	});

	/**
	 * @constant {Number} CLOSING
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CLOSING', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSING')
	});

	/**
	 * @constant {Number} CLOSING
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CLOSING', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSING')
	});

	/**
	 * @constant {Number} CLOSED
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CLOSED', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSED')
	});

	/**
	 * @constant {Number} CLOSED
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CLOSED', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSED')
	});

	[
	  'binaryType',
	  'bufferedAmount',
	  'extensions',
	  'isPaused',
	  'protocol',
	  'readyState',
	  'url'
	].forEach((property) => {
	  Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
	});

	//
	// Add the `onopen`, `onerror`, `onclose`, and `onmessage` attributes.
	// See https://html.spec.whatwg.org/multipage/comms.html#the-websocket-interface
	//
	['open', 'error', 'close', 'message'].forEach((method) => {
	  Object.defineProperty(WebSocket.prototype, `on${method}`, {
	    enumerable: true,
	    get() {
	      for (const listener of this.listeners(method)) {
	        if (listener[kForOnEventAttribute]) return listener[kListener];
	      }

	      return null;
	    },
	    set(handler) {
	      for (const listener of this.listeners(method)) {
	        if (listener[kForOnEventAttribute]) {
	          this.removeListener(method, listener);
	          break;
	        }
	      }

	      if (typeof handler !== 'function') return;

	      this.addEventListener(method, handler, {
	        [kForOnEventAttribute]: true
	      });
	    }
	  });
	});

	WebSocket.prototype.addEventListener = addEventListener;
	WebSocket.prototype.removeEventListener = removeEventListener;

	websocket = WebSocket;

	/**
	 * Initialize a WebSocket client.
	 *
	 * @param {WebSocket} websocket The client to initialize
	 * @param {(String|URL)} address The URL to which to connect
	 * @param {Array} protocols The subprotocols
	 * @param {Object} [options] Connection options
	 * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether any
	 *     of the `'message'`, `'ping'`, and `'pong'` events can be emitted multiple
	 *     times in the same tick
	 * @param {Boolean} [options.autoPong=true] Specifies whether or not to
	 *     automatically send a pong in response to a ping
	 * @param {Function} [options.finishRequest] A function which can be used to
	 *     customize the headers of each http request before it is sent
	 * @param {Boolean} [options.followRedirects=false] Whether or not to follow
	 *     redirects
	 * @param {Function} [options.generateMask] The function used to generate the
	 *     masking key
	 * @param {Number} [options.handshakeTimeout] Timeout in milliseconds for the
	 *     handshake request
	 * @param {Number} [options.maxPayload=104857600] The maximum allowed message
	 *     size
	 * @param {Number} [options.maxRedirects=10] The maximum number of redirects
	 *     allowed
	 * @param {String} [options.origin] Value of the `Origin` or
	 *     `Sec-WebSocket-Origin` header
	 * @param {(Boolean|Object)} [options.perMessageDeflate=true] Enable/disable
	 *     permessage-deflate
	 * @param {Number} [options.protocolVersion=13] Value of the
	 *     `Sec-WebSocket-Version` header
	 * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	 *     not to skip UTF-8 validation for text and close messages
	 * @private
	 */
	function initAsClient(websocket, address, protocols, options) {
	  const opts = {
	    allowSynchronousEvents: true,
	    autoPong: true,
	    protocolVersion: protocolVersions[1],
	    maxPayload: 100 * 1024 * 1024,
	    skipUTF8Validation: false,
	    perMessageDeflate: true,
	    followRedirects: false,
	    maxRedirects: 10,
	    ...options,
	    socketPath: undefined,
	    hostname: undefined,
	    protocol: undefined,
	    timeout: undefined,
	    method: 'GET',
	    host: undefined,
	    path: undefined,
	    port: undefined
	  };

	  websocket._autoPong = opts.autoPong;

	  if (!protocolVersions.includes(opts.protocolVersion)) {
	    throw new RangeError(
	      `Unsupported protocol version: ${opts.protocolVersion} ` +
	        `(supported versions: ${protocolVersions.join(', ')})`
	    );
	  }

	  let parsedUrl;

	  if (address instanceof URL) {
	    parsedUrl = address;
	  } else {
	    try {
	      parsedUrl = new URL(address);
	    } catch (e) {
	      throw new SyntaxError(`Invalid URL: ${address}`);
	    }
	  }

	  if (parsedUrl.protocol === 'http:') {
	    parsedUrl.protocol = 'ws:';
	  } else if (parsedUrl.protocol === 'https:') {
	    parsedUrl.protocol = 'wss:';
	  }

	  websocket._url = parsedUrl.href;

	  const isSecure = parsedUrl.protocol === 'wss:';
	  const isIpcUrl = parsedUrl.protocol === 'ws+unix:';
	  let invalidUrlMessage;

	  if (parsedUrl.protocol !== 'ws:' && !isSecure && !isIpcUrl) {
	    invalidUrlMessage =
	      'The URL\'s protocol must be one of "ws:", "wss:", ' +
	      '"http:", "https:", or "ws+unix:"';
	  } else if (isIpcUrl && !parsedUrl.pathname) {
	    invalidUrlMessage = "The URL's pathname is empty";
	  } else if (parsedUrl.hash) {
	    invalidUrlMessage = 'The URL contains a fragment identifier';
	  }

	  if (invalidUrlMessage) {
	    const err = new SyntaxError(invalidUrlMessage);

	    if (websocket._redirects === 0) {
	      throw err;
	    } else {
	      emitErrorAndClose(websocket, err);
	      return;
	    }
	  }

	  const defaultPort = isSecure ? 443 : 80;
	  const key = randomBytes(16).toString('base64');
	  const request = isSecure ? https.request : http.request;
	  const protocolSet = new Set();
	  let perMessageDeflate;

	  opts.createConnection =
	    opts.createConnection || (isSecure ? tlsConnect : netConnect);
	  opts.defaultPort = opts.defaultPort || defaultPort;
	  opts.port = parsedUrl.port || defaultPort;
	  opts.host = parsedUrl.hostname.startsWith('[')
	    ? parsedUrl.hostname.slice(1, -1)
	    : parsedUrl.hostname;
	  opts.headers = {
	    ...opts.headers,
	    'Sec-WebSocket-Version': opts.protocolVersion,
	    'Sec-WebSocket-Key': key,
	    Connection: 'Upgrade',
	    Upgrade: 'websocket'
	  };
	  opts.path = parsedUrl.pathname + parsedUrl.search;
	  opts.timeout = opts.handshakeTimeout;

	  if (opts.perMessageDeflate) {
	    perMessageDeflate = new PerMessageDeflate(
	      opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
	      false,
	      opts.maxPayload
	    );
	    opts.headers['Sec-WebSocket-Extensions'] = format({
	      [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
	    });
	  }
	  if (protocols.length) {
	    for (const protocol of protocols) {
	      if (
	        typeof protocol !== 'string' ||
	        !subprotocolRegex.test(protocol) ||
	        protocolSet.has(protocol)
	      ) {
	        throw new SyntaxError(
	          'An invalid or duplicated subprotocol was specified'
	        );
	      }

	      protocolSet.add(protocol);
	    }

	    opts.headers['Sec-WebSocket-Protocol'] = protocols.join(',');
	  }
	  if (opts.origin) {
	    if (opts.protocolVersion < 13) {
	      opts.headers['Sec-WebSocket-Origin'] = opts.origin;
	    } else {
	      opts.headers.Origin = opts.origin;
	    }
	  }
	  if (parsedUrl.username || parsedUrl.password) {
	    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
	  }

	  if (isIpcUrl) {
	    const parts = opts.path.split(':');

	    opts.socketPath = parts[0];
	    opts.path = parts[1];
	  }

	  let req;

	  if (opts.followRedirects) {
	    if (websocket._redirects === 0) {
	      websocket._originalIpc = isIpcUrl;
	      websocket._originalSecure = isSecure;
	      websocket._originalHostOrSocketPath = isIpcUrl
	        ? opts.socketPath
	        : parsedUrl.host;

	      const headers = options && options.headers;

	      //
	      // Shallow copy the user provided options so that headers can be changed
	      // without mutating the original object.
	      //
	      options = { ...options, headers: {} };

	      if (headers) {
	        for (const [key, value] of Object.entries(headers)) {
	          options.headers[key.toLowerCase()] = value;
	        }
	      }
	    } else if (websocket.listenerCount('redirect') === 0) {
	      const isSameHost = isIpcUrl
	        ? websocket._originalIpc
	          ? opts.socketPath === websocket._originalHostOrSocketPath
	          : false
	        : websocket._originalIpc
	          ? false
	          : parsedUrl.host === websocket._originalHostOrSocketPath;

	      if (!isSameHost || (websocket._originalSecure && !isSecure)) {
	        //
	        // Match curl 7.77.0 behavior and drop the following headers. These
	        // headers are also dropped when following a redirect to a subdomain.
	        //
	        delete opts.headers.authorization;
	        delete opts.headers.cookie;

	        if (!isSameHost) delete opts.headers.host;

	        opts.auth = undefined;
	      }
	    }

	    //
	    // Match curl 7.77.0 behavior and make the first `Authorization` header win.
	    // If the `Authorization` header is set, then there is nothing to do as it
	    // will take precedence.
	    //
	    if (opts.auth && !options.headers.authorization) {
	      options.headers.authorization =
	        'Basic ' + Buffer.from(opts.auth).toString('base64');
	    }

	    req = websocket._req = request(opts);

	    if (websocket._redirects) {
	      //
	      // Unlike what is done for the `'upgrade'` event, no early exit is
	      // triggered here if the user calls `websocket.close()` or
	      // `websocket.terminate()` from a listener of the `'redirect'` event. This
	      // is because the user can also call `request.destroy()` with an error
	      // before calling `websocket.close()` or `websocket.terminate()` and this
	      // would result in an error being emitted on the `request` object with no
	      // `'error'` event listeners attached.
	      //
	      websocket.emit('redirect', websocket.url, req);
	    }
	  } else {
	    req = websocket._req = request(opts);
	  }

	  if (opts.timeout) {
	    req.on('timeout', () => {
	      abortHandshake(websocket, req, 'Opening handshake has timed out');
	    });
	  }

	  req.on('error', (err) => {
	    if (req === null || req[kAborted]) return;

	    req = websocket._req = null;
	    emitErrorAndClose(websocket, err);
	  });

	  req.on('response', (res) => {
	    const location = res.headers.location;
	    const statusCode = res.statusCode;

	    if (
	      location &&
	      opts.followRedirects &&
	      statusCode >= 300 &&
	      statusCode < 400
	    ) {
	      if (++websocket._redirects > opts.maxRedirects) {
	        abortHandshake(websocket, req, 'Maximum redirects exceeded');
	        return;
	      }

	      req.abort();

	      let addr;

	      try {
	        addr = new URL(location, address);
	      } catch (e) {
	        const err = new SyntaxError(`Invalid URL: ${location}`);
	        emitErrorAndClose(websocket, err);
	        return;
	      }

	      initAsClient(websocket, addr, protocols, options);
	    } else if (!websocket.emit('unexpected-response', req, res)) {
	      abortHandshake(
	        websocket,
	        req,
	        `Unexpected server response: ${res.statusCode}`
	      );
	    }
	  });

	  req.on('upgrade', (res, socket, head) => {
	    websocket.emit('upgrade', res);

	    //
	    // The user may have closed the connection from a listener of the
	    // `'upgrade'` event.
	    //
	    if (websocket.readyState !== WebSocket.CONNECTING) return;

	    req = websocket._req = null;

	    const upgrade = res.headers.upgrade;

	    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
	      abortHandshake(websocket, socket, 'Invalid Upgrade header');
	      return;
	    }

	    const digest = createHash('sha1')
	      .update(key + GUID)
	      .digest('base64');

	    if (res.headers['sec-websocket-accept'] !== digest) {
	      abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Accept header');
	      return;
	    }

	    const serverProt = res.headers['sec-websocket-protocol'];
	    let protError;

	    if (serverProt !== undefined) {
	      if (!protocolSet.size) {
	        protError = 'Server sent a subprotocol but none was requested';
	      } else if (!protocolSet.has(serverProt)) {
	        protError = 'Server sent an invalid subprotocol';
	      }
	    } else if (protocolSet.size) {
	      protError = 'Server sent no subprotocol';
	    }

	    if (protError) {
	      abortHandshake(websocket, socket, protError);
	      return;
	    }

	    if (serverProt) websocket._protocol = serverProt;

	    const secWebSocketExtensions = res.headers['sec-websocket-extensions'];

	    if (secWebSocketExtensions !== undefined) {
	      if (!perMessageDeflate) {
	        const message =
	          'Server sent a Sec-WebSocket-Extensions header but no extension ' +
	          'was requested';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      let extensions;

	      try {
	        extensions = parse(secWebSocketExtensions);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Extensions header';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      const extensionNames = Object.keys(extensions);

	      if (
	        extensionNames.length !== 1 ||
	        extensionNames[0] !== PerMessageDeflate.extensionName
	      ) {
	        const message = 'Server indicated an extension that was not requested';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      try {
	        perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Extensions header';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      websocket._extensions[PerMessageDeflate.extensionName] =
	        perMessageDeflate;
	    }

	    websocket.setSocket(socket, head, {
	      allowSynchronousEvents: opts.allowSynchronousEvents,
	      generateMask: opts.generateMask,
	      maxPayload: opts.maxPayload,
	      skipUTF8Validation: opts.skipUTF8Validation
	    });
	  });

	  if (opts.finishRequest) {
	    opts.finishRequest(req, websocket);
	  } else {
	    req.end();
	  }
	}

	/**
	 * Emit the `'error'` and `'close'` events.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {Error} The error to emit
	 * @private
	 */
	function emitErrorAndClose(websocket, err) {
	  websocket._readyState = WebSocket.CLOSING;
	  //
	  // The following assignment is practically useless and is done only for
	  // consistency.
	  //
	  websocket._errorEmitted = true;
	  websocket.emit('error', err);
	  websocket.emitClose();
	}

	/**
	 * Create a `net.Socket` and initiate a connection.
	 *
	 * @param {Object} options Connection options
	 * @return {net.Socket} The newly created socket used to start the connection
	 * @private
	 */
	function netConnect(options) {
	  options.path = options.socketPath;
	  return net.connect(options);
	}

	/**
	 * Create a `tls.TLSSocket` and initiate a connection.
	 *
	 * @param {Object} options Connection options
	 * @return {tls.TLSSocket} The newly created socket used to start the connection
	 * @private
	 */
	function tlsConnect(options) {
	  options.path = undefined;

	  if (!options.servername && options.servername !== '') {
	    options.servername = net.isIP(options.host) ? '' : options.host;
	  }

	  return tls.connect(options);
	}

	/**
	 * Abort the handshake and emit an error.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {(http.ClientRequest|net.Socket|tls.Socket)} stream The request to
	 *     abort or the socket to destroy
	 * @param {String} message The error message
	 * @private
	 */
	function abortHandshake(websocket, stream, message) {
	  websocket._readyState = WebSocket.CLOSING;

	  const err = new Error(message);
	  Error.captureStackTrace(err, abortHandshake);

	  if (stream.setHeader) {
	    stream[kAborted] = true;
	    stream.abort();

	    if (stream.socket && !stream.socket.destroyed) {
	      //
	      // On Node.js >= 14.3.0 `request.abort()` does not destroy the socket if
	      // called after the request completed. See
	      // https://github.com/websockets/ws/issues/1869.
	      //
	      stream.socket.destroy();
	    }

	    process.nextTick(emitErrorAndClose, websocket, err);
	  } else {
	    stream.destroy(err);
	    stream.once('error', websocket.emit.bind(websocket, 'error'));
	    stream.once('close', websocket.emitClose.bind(websocket));
	  }
	}

	/**
	 * Handle cases where the `ping()`, `pong()`, or `send()` methods are called
	 * when the `readyState` attribute is `CLOSING` or `CLOSED`.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {*} [data] The data to send
	 * @param {Function} [cb] Callback
	 * @private
	 */
	function sendAfterClose(websocket, data, cb) {
	  if (data) {
	    const length = isBlob(data) ? data.size : toBuffer(data).length;

	    //
	    // The `_bufferedAmount` property is used only when the peer is a client and
	    // the opening handshake fails. Under these circumstances, in fact, the
	    // `setSocket()` method is not called, so the `_socket` and `_sender`
	    // properties are set to `null`.
	    //
	    if (websocket._socket) websocket._sender._bufferedBytes += length;
	    else websocket._bufferedAmount += length;
	  }

	  if (cb) {
	    const err = new Error(
	      `WebSocket is not open: readyState ${websocket.readyState} ` +
	        `(${readyStates[websocket.readyState]})`
	    );
	    process.nextTick(cb, err);
	  }
	}

	/**
	 * The listener of the `Receiver` `'conclude'` event.
	 *
	 * @param {Number} code The status code
	 * @param {Buffer} reason The reason for closing
	 * @private
	 */
	function receiverOnConclude(code, reason) {
	  const websocket = this[kWebSocket];

	  websocket._closeFrameReceived = true;
	  websocket._closeMessage = reason;
	  websocket._closeCode = code;

	  if (websocket._socket[kWebSocket] === undefined) return;

	  websocket._socket.removeListener('data', socketOnData);
	  process.nextTick(resume, websocket._socket);

	  if (code === 1005) websocket.close();
	  else websocket.close(code, reason);
	}

	/**
	 * The listener of the `Receiver` `'drain'` event.
	 *
	 * @private
	 */
	function receiverOnDrain() {
	  const websocket = this[kWebSocket];

	  if (!websocket.isPaused) websocket._socket.resume();
	}

	/**
	 * The listener of the `Receiver` `'error'` event.
	 *
	 * @param {(RangeError|Error)} err The emitted error
	 * @private
	 */
	function receiverOnError(err) {
	  const websocket = this[kWebSocket];

	  if (websocket._socket[kWebSocket] !== undefined) {
	    websocket._socket.removeListener('data', socketOnData);

	    //
	    // On Node.js < 14.0.0 the `'error'` event is emitted synchronously. See
	    // https://github.com/websockets/ws/issues/1940.
	    //
	    process.nextTick(resume, websocket._socket);

	    websocket.close(err[kStatusCode]);
	  }

	  if (!websocket._errorEmitted) {
	    websocket._errorEmitted = true;
	    websocket.emit('error', err);
	  }
	}

	/**
	 * The listener of the `Receiver` `'finish'` event.
	 *
	 * @private
	 */
	function receiverOnFinish() {
	  this[kWebSocket].emitClose();
	}

	/**
	 * The listener of the `Receiver` `'message'` event.
	 *
	 * @param {Buffer|ArrayBuffer|Buffer[])} data The message
	 * @param {Boolean} isBinary Specifies whether the message is binary or not
	 * @private
	 */
	function receiverOnMessage(data, isBinary) {
	  this[kWebSocket].emit('message', data, isBinary);
	}

	/**
	 * The listener of the `Receiver` `'ping'` event.
	 *
	 * @param {Buffer} data The data included in the ping frame
	 * @private
	 */
	function receiverOnPing(data) {
	  const websocket = this[kWebSocket];

	  if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
	  websocket.emit('ping', data);
	}

	/**
	 * The listener of the `Receiver` `'pong'` event.
	 *
	 * @param {Buffer} data The data included in the pong frame
	 * @private
	 */
	function receiverOnPong(data) {
	  this[kWebSocket].emit('pong', data);
	}

	/**
	 * Resume a readable stream
	 *
	 * @param {Readable} stream The readable stream
	 * @private
	 */
	function resume(stream) {
	  stream.resume();
	}

	/**
	 * The `Sender` error event handler.
	 *
	 * @param {Error} The error
	 * @private
	 */
	function senderOnError(err) {
	  const websocket = this[kWebSocket];

	  if (websocket.readyState === WebSocket.CLOSED) return;
	  if (websocket.readyState === WebSocket.OPEN) {
	    websocket._readyState = WebSocket.CLOSING;
	    setCloseTimer(websocket);
	  }

	  //
	  // `socket.end()` is used instead of `socket.destroy()` to allow the other
	  // peer to finish sending queued data. There is no need to set a timer here
	  // because `CLOSING` means that it is already set or not needed.
	  //
	  this._socket.end();

	  if (!websocket._errorEmitted) {
	    websocket._errorEmitted = true;
	    websocket.emit('error', err);
	  }
	}

	/**
	 * Set a timer to destroy the underlying raw socket of a WebSocket.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @private
	 */
	function setCloseTimer(websocket) {
	  websocket._closeTimer = setTimeout(
	    websocket._socket.destroy.bind(websocket._socket),
	    closeTimeout
	  );
	}

	/**
	 * The listener of the socket `'close'` event.
	 *
	 * @private
	 */
	function socketOnClose() {
	  const websocket = this[kWebSocket];

	  this.removeListener('close', socketOnClose);
	  this.removeListener('data', socketOnData);
	  this.removeListener('end', socketOnEnd);

	  websocket._readyState = WebSocket.CLOSING;

	  let chunk;

	  //
	  // The close frame might not have been received or the `'end'` event emitted,
	  // for example, if the socket was destroyed due to an error. Ensure that the
	  // `receiver` stream is closed after writing any remaining buffered data to
	  // it. If the readable side of the socket is in flowing mode then there is no
	  // buffered data as everything has been already written and `readable.read()`
	  // will return `null`. If instead, the socket is paused, any possible buffered
	  // data will be read as a single chunk.
	  //
	  if (
	    !this._readableState.endEmitted &&
	    !websocket._closeFrameReceived &&
	    !websocket._receiver._writableState.errorEmitted &&
	    (chunk = websocket._socket.read()) !== null
	  ) {
	    websocket._receiver.write(chunk);
	  }

	  websocket._receiver.end();

	  this[kWebSocket] = undefined;

	  clearTimeout(websocket._closeTimer);

	  if (
	    websocket._receiver._writableState.finished ||
	    websocket._receiver._writableState.errorEmitted
	  ) {
	    websocket.emitClose();
	  } else {
	    websocket._receiver.on('error', receiverOnFinish);
	    websocket._receiver.on('finish', receiverOnFinish);
	  }
	}

	/**
	 * The listener of the socket `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function socketOnData(chunk) {
	  if (!this[kWebSocket]._receiver.write(chunk)) {
	    this.pause();
	  }
	}

	/**
	 * The listener of the socket `'end'` event.
	 *
	 * @private
	 */
	function socketOnEnd() {
	  const websocket = this[kWebSocket];

	  websocket._readyState = WebSocket.CLOSING;
	  websocket._receiver.end();
	  this.end();
	}

	/**
	 * The listener of the socket `'error'` event.
	 *
	 * @private
	 */
	function socketOnError() {
	  const websocket = this[kWebSocket];

	  this.removeListener('error', socketOnError);
	  this.on('error', NOOP);

	  if (websocket) {
	    websocket._readyState = WebSocket.CLOSING;
	    this.destroy();
	  }
	}
	return websocket;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^WebSocket$" }] */

var stream;
var hasRequiredStream;

function requireStream () {
	if (hasRequiredStream) return stream;
	hasRequiredStream = 1;

	requireWebsocket();
	const { Duplex } = require$$0$2;

	/**
	 * Emits the `'close'` event on a stream.
	 *
	 * @param {Duplex} stream The stream.
	 * @private
	 */
	function emitClose(stream) {
	  stream.emit('close');
	}

	/**
	 * The listener of the `'end'` event.
	 *
	 * @private
	 */
	function duplexOnEnd() {
	  if (!this.destroyed && this._writableState.finished) {
	    this.destroy();
	  }
	}

	/**
	 * The listener of the `'error'` event.
	 *
	 * @param {Error} err The error
	 * @private
	 */
	function duplexOnError(err) {
	  this.removeListener('error', duplexOnError);
	  this.destroy();
	  if (this.listenerCount('error') === 0) {
	    // Do not suppress the throwing behavior.
	    this.emit('error', err);
	  }
	}

	/**
	 * Wraps a `WebSocket` in a duplex stream.
	 *
	 * @param {WebSocket} ws The `WebSocket` to wrap
	 * @param {Object} [options] The options for the `Duplex` constructor
	 * @return {Duplex} The duplex stream
	 * @public
	 */
	function createWebSocketStream(ws, options) {
	  let terminateOnDestroy = true;

	  const duplex = new Duplex({
	    ...options,
	    autoDestroy: false,
	    emitClose: false,
	    objectMode: false,
	    writableObjectMode: false
	  });

	  ws.on('message', function message(msg, isBinary) {
	    const data =
	      !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;

	    if (!duplex.push(data)) ws.pause();
	  });

	  ws.once('error', function error(err) {
	    if (duplex.destroyed) return;

	    // Prevent `ws.terminate()` from being called by `duplex._destroy()`.
	    //
	    // - If the `'error'` event is emitted before the `'open'` event, then
	    //   `ws.terminate()` is a noop as no socket is assigned.
	    // - Otherwise, the error is re-emitted by the listener of the `'error'`
	    //   event of the `Receiver` object. The listener already closes the
	    //   connection by calling `ws.close()`. This allows a close frame to be
	    //   sent to the other peer. If `ws.terminate()` is called right after this,
	    //   then the close frame might not be sent.
	    terminateOnDestroy = false;
	    duplex.destroy(err);
	  });

	  ws.once('close', function close() {
	    if (duplex.destroyed) return;

	    duplex.push(null);
	  });

	  duplex._destroy = function (err, callback) {
	    if (ws.readyState === ws.CLOSED) {
	      callback(err);
	      process.nextTick(emitClose, duplex);
	      return;
	    }

	    let called = false;

	    ws.once('error', function error(err) {
	      called = true;
	      callback(err);
	    });

	    ws.once('close', function close() {
	      if (!called) callback(err);
	      process.nextTick(emitClose, duplex);
	    });

	    if (terminateOnDestroy) ws.terminate();
	  };

	  duplex._final = function (callback) {
	    if (ws.readyState === ws.CONNECTING) {
	      ws.once('open', function open() {
	        duplex._final(callback);
	      });
	      return;
	    }

	    // If the value of the `_socket` property is `null` it means that `ws` is a
	    // client websocket and the handshake failed. In fact, when this happens, a
	    // socket is never assigned to the websocket. Wait for the `'error'` event
	    // that will be emitted by the websocket.
	    if (ws._socket === null) return;

	    if (ws._socket._writableState.finished) {
	      callback();
	      if (duplex._readableState.endEmitted) duplex.destroy();
	    } else {
	      ws._socket.once('finish', function finish() {
	        // `duplex` is not destroyed here because the `'end'` event will be
	        // emitted on `duplex` after this `'finish'` event. The EOF signaling
	        // `null` chunk is, in fact, pushed when the websocket emits `'close'`.
	        callback();
	      });
	      ws.close();
	    }
	  };

	  duplex._read = function () {
	    if (ws.isPaused) ws.resume();
	  };

	  duplex._write = function (chunk, encoding, callback) {
	    if (ws.readyState === ws.CONNECTING) {
	      ws.once('open', function open() {
	        duplex._write(chunk, encoding, callback);
	      });
	      return;
	    }

	    ws.send(chunk, callback);
	  };

	  duplex.on('end', duplexOnEnd);
	  duplex.on('error', duplexOnError);
	  return duplex;
	}

	stream = createWebSocketStream;
	return stream;
}

requireStream();

requireReceiver();

requireSender();

var websocketExports = requireWebsocket();
var WebSocket = /*@__PURE__*/getDefaultExportFromCjs(websocketExports);

var subprotocol;
var hasRequiredSubprotocol;

function requireSubprotocol () {
	if (hasRequiredSubprotocol) return subprotocol;
	hasRequiredSubprotocol = 1;

	const { tokenChars } = requireValidation();

	/**
	 * Parses the `Sec-WebSocket-Protocol` header into a set of subprotocol names.
	 *
	 * @param {String} header The field value of the header
	 * @return {Set} The subprotocol names
	 * @public
	 */
	function parse(header) {
	  const protocols = new Set();
	  let start = -1;
	  let end = -1;
	  let i = 0;

	  for (i; i < header.length; i++) {
	    const code = header.charCodeAt(i);

	    if (end === -1 && tokenChars[code] === 1) {
	      if (start === -1) start = i;
	    } else if (
	      i !== 0 &&
	      (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
	    ) {
	      if (end === -1 && start !== -1) end = i;
	    } else if (code === 0x2c /* ',' */) {
	      if (start === -1) {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }

	      if (end === -1) end = i;

	      const protocol = header.slice(start, end);

	      if (protocols.has(protocol)) {
	        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
	      }

	      protocols.add(protocol);
	      start = end = -1;
	    } else {
	      throw new SyntaxError(`Unexpected character at index ${i}`);
	    }
	  }

	  if (start === -1 || end !== -1) {
	    throw new SyntaxError('Unexpected end of input');
	  }

	  const protocol = header.slice(start, i);

	  if (protocols.has(protocol)) {
	    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
	  }

	  protocols.add(protocol);
	  return protocols;
	}

	subprotocol = { parse };
	return subprotocol;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex$", "caughtErrors": "none" }] */

var websocketServer;
var hasRequiredWebsocketServer;

function requireWebsocketServer () {
	if (hasRequiredWebsocketServer) return websocketServer;
	hasRequiredWebsocketServer = 1;

	const EventEmitter = require$$0$3;
	const http = require$$2;
	const { Duplex } = require$$0$2;
	const { createHash } = require$$1;

	const extension = requireExtension();
	const PerMessageDeflate = requirePermessageDeflate();
	const subprotocol = requireSubprotocol();
	const WebSocket = requireWebsocket();
	const { GUID, kWebSocket } = requireConstants();

	const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

	const RUNNING = 0;
	const CLOSING = 1;
	const CLOSED = 2;

	/**
	 * Class representing a WebSocket server.
	 *
	 * @extends EventEmitter
	 */
	class WebSocketServer extends EventEmitter {
	  /**
	   * Create a `WebSocketServer` instance.
	   *
	   * @param {Object} options Configuration options
	   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {Boolean} [options.autoPong=true] Specifies whether or not to
	   *     automatically send a pong in response to a ping
	   * @param {Number} [options.backlog=511] The maximum length of the queue of
	   *     pending connections
	   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
	   *     track clients
	   * @param {Function} [options.handleProtocols] A hook to handle protocols
	   * @param {String} [options.host] The hostname where to bind the server
	   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
	   *     size
	   * @param {Boolean} [options.noServer=false] Enable no server mode
	   * @param {String} [options.path] Accept only connections matching this path
	   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
	   *     permessage-deflate
	   * @param {Number} [options.port] The port where to bind the server
	   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
	   *     server to use
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   * @param {Function} [options.verifyClient] A hook to reject connections
	   * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
	   *     class to use. It must be the `WebSocket` class or class that extends it
	   * @param {Function} [callback] A listener for the `listening` event
	   */
	  constructor(options, callback) {
	    super();

	    options = {
	      allowSynchronousEvents: true,
	      autoPong: true,
	      maxPayload: 100 * 1024 * 1024,
	      skipUTF8Validation: false,
	      perMessageDeflate: false,
	      handleProtocols: null,
	      clientTracking: true,
	      verifyClient: null,
	      noServer: false,
	      backlog: null, // use default (511 as implemented in net.js)
	      server: null,
	      host: null,
	      path: null,
	      port: null,
	      WebSocket,
	      ...options
	    };

	    if (
	      (options.port == null && !options.server && !options.noServer) ||
	      (options.port != null && (options.server || options.noServer)) ||
	      (options.server && options.noServer)
	    ) {
	      throw new TypeError(
	        'One and only one of the "port", "server", or "noServer" options ' +
	          'must be specified'
	      );
	    }

	    if (options.port != null) {
	      this._server = http.createServer((req, res) => {
	        const body = http.STATUS_CODES[426];

	        res.writeHead(426, {
	          'Content-Length': body.length,
	          'Content-Type': 'text/plain'
	        });
	        res.end(body);
	      });
	      this._server.listen(
	        options.port,
	        options.host,
	        options.backlog,
	        callback
	      );
	    } else if (options.server) {
	      this._server = options.server;
	    }

	    if (this._server) {
	      const emitConnection = this.emit.bind(this, 'connection');

	      this._removeListeners = addListeners(this._server, {
	        listening: this.emit.bind(this, 'listening'),
	        error: this.emit.bind(this, 'error'),
	        upgrade: (req, socket, head) => {
	          this.handleUpgrade(req, socket, head, emitConnection);
	        }
	      });
	    }

	    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
	    if (options.clientTracking) {
	      this.clients = new Set();
	      this._shouldEmitClose = false;
	    }

	    this.options = options;
	    this._state = RUNNING;
	  }

	  /**
	   * Returns the bound address, the address family name, and port of the server
	   * as reported by the operating system if listening on an IP socket.
	   * If the server is listening on a pipe or UNIX domain socket, the name is
	   * returned as a string.
	   *
	   * @return {(Object|String|null)} The address of the server
	   * @public
	   */
	  address() {
	    if (this.options.noServer) {
	      throw new Error('The server is operating in "noServer" mode');
	    }

	    if (!this._server) return null;
	    return this._server.address();
	  }

	  /**
	   * Stop the server from accepting new connections and emit the `'close'` event
	   * when all existing connections are closed.
	   *
	   * @param {Function} [cb] A one-time listener for the `'close'` event
	   * @public
	   */
	  close(cb) {
	    if (this._state === CLOSED) {
	      if (cb) {
	        this.once('close', () => {
	          cb(new Error('The server is not running'));
	        });
	      }

	      process.nextTick(emitClose, this);
	      return;
	    }

	    if (cb) this.once('close', cb);

	    if (this._state === CLOSING) return;
	    this._state = CLOSING;

	    if (this.options.noServer || this.options.server) {
	      if (this._server) {
	        this._removeListeners();
	        this._removeListeners = this._server = null;
	      }

	      if (this.clients) {
	        if (!this.clients.size) {
	          process.nextTick(emitClose, this);
	        } else {
	          this._shouldEmitClose = true;
	        }
	      } else {
	        process.nextTick(emitClose, this);
	      }
	    } else {
	      const server = this._server;

	      this._removeListeners();
	      this._removeListeners = this._server = null;

	      //
	      // The HTTP/S server was created internally. Close it, and rely on its
	      // `'close'` event.
	      //
	      server.close(() => {
	        emitClose(this);
	      });
	    }
	  }

	  /**
	   * See if a given request should be handled by this server instance.
	   *
	   * @param {http.IncomingMessage} req Request object to inspect
	   * @return {Boolean} `true` if the request is valid, else `false`
	   * @public
	   */
	  shouldHandle(req) {
	    if (this.options.path) {
	      const index = req.url.indexOf('?');
	      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

	      if (pathname !== this.options.path) return false;
	    }

	    return true;
	  }

	  /**
	   * Handle a HTTP Upgrade request.
	   *
	   * @param {http.IncomingMessage} req The request object
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Function} cb Callback
	   * @public
	   */
	  handleUpgrade(req, socket, head, cb) {
	    socket.on('error', socketOnError);

	    const key = req.headers['sec-websocket-key'];
	    const upgrade = req.headers.upgrade;
	    const version = +req.headers['sec-websocket-version'];

	    if (req.method !== 'GET') {
	      const message = 'Invalid HTTP method';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
	      return;
	    }

	    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
	      const message = 'Invalid Upgrade header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	      return;
	    }

	    if (key === undefined || !keyRegex.test(key)) {
	      const message = 'Missing or invalid Sec-WebSocket-Key header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	      return;
	    }

	    if (version !== 13 && version !== 8) {
	      const message = 'Missing or invalid Sec-WebSocket-Version header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
	        'Sec-WebSocket-Version': '13, 8'
	      });
	      return;
	    }

	    if (!this.shouldHandle(req)) {
	      abortHandshake(socket, 400);
	      return;
	    }

	    const secWebSocketProtocol = req.headers['sec-websocket-protocol'];
	    let protocols = new Set();

	    if (secWebSocketProtocol !== undefined) {
	      try {
	        protocols = subprotocol.parse(secWebSocketProtocol);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Protocol header';
	        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	        return;
	      }
	    }

	    const secWebSocketExtensions = req.headers['sec-websocket-extensions'];
	    const extensions = {};

	    if (
	      this.options.perMessageDeflate &&
	      secWebSocketExtensions !== undefined
	    ) {
	      const perMessageDeflate = new PerMessageDeflate(
	        this.options.perMessageDeflate,
	        true,
	        this.options.maxPayload
	      );

	      try {
	        const offers = extension.parse(secWebSocketExtensions);

	        if (offers[PerMessageDeflate.extensionName]) {
	          perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
	          extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
	        }
	      } catch (err) {
	        const message =
	          'Invalid or unacceptable Sec-WebSocket-Extensions header';
	        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	        return;
	      }
	    }

	    //
	    // Optionally call external client verification handler.
	    //
	    if (this.options.verifyClient) {
	      const info = {
	        origin:
	          req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
	        secure: !!(req.socket.authorized || req.socket.encrypted),
	        req
	      };

	      if (this.options.verifyClient.length === 2) {
	        this.options.verifyClient(info, (verified, code, message, headers) => {
	          if (!verified) {
	            return abortHandshake(socket, code || 401, message, headers);
	          }

	          this.completeUpgrade(
	            extensions,
	            key,
	            protocols,
	            req,
	            socket,
	            head,
	            cb
	          );
	        });
	        return;
	      }

	      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
	    }

	    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
	  }

	  /**
	   * Upgrade the connection to WebSocket.
	   *
	   * @param {Object} extensions The accepted extensions
	   * @param {String} key The value of the `Sec-WebSocket-Key` header
	   * @param {Set} protocols The subprotocols
	   * @param {http.IncomingMessage} req The request object
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Function} cb Callback
	   * @throws {Error} If called more than once with the same socket
	   * @private
	   */
	  completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
	    //
	    // Destroy the socket if the client has already sent a FIN packet.
	    //
	    if (!socket.readable || !socket.writable) return socket.destroy();

	    if (socket[kWebSocket]) {
	      throw new Error(
	        'server.handleUpgrade() was called more than once with the same ' +
	          'socket, possibly due to a misconfiguration'
	      );
	    }

	    if (this._state > RUNNING) return abortHandshake(socket, 503);

	    const digest = createHash('sha1')
	      .update(key + GUID)
	      .digest('base64');

	    const headers = [
	      'HTTP/1.1 101 Switching Protocols',
	      'Upgrade: websocket',
	      'Connection: Upgrade',
	      `Sec-WebSocket-Accept: ${digest}`
	    ];

	    const ws = new this.options.WebSocket(null, undefined, this.options);

	    if (protocols.size) {
	      //
	      // Optionally call external protocol selection handler.
	      //
	      const protocol = this.options.handleProtocols
	        ? this.options.handleProtocols(protocols, req)
	        : protocols.values().next().value;

	      if (protocol) {
	        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
	        ws._protocol = protocol;
	      }
	    }

	    if (extensions[PerMessageDeflate.extensionName]) {
	      const params = extensions[PerMessageDeflate.extensionName].params;
	      const value = extension.format({
	        [PerMessageDeflate.extensionName]: [params]
	      });
	      headers.push(`Sec-WebSocket-Extensions: ${value}`);
	      ws._extensions = extensions;
	    }

	    //
	    // Allow external modification/inspection of handshake headers.
	    //
	    this.emit('headers', headers, req);

	    socket.write(headers.concat('\r\n').join('\r\n'));
	    socket.removeListener('error', socketOnError);

	    ws.setSocket(socket, head, {
	      allowSynchronousEvents: this.options.allowSynchronousEvents,
	      maxPayload: this.options.maxPayload,
	      skipUTF8Validation: this.options.skipUTF8Validation
	    });

	    if (this.clients) {
	      this.clients.add(ws);
	      ws.on('close', () => {
	        this.clients.delete(ws);

	        if (this._shouldEmitClose && !this.clients.size) {
	          process.nextTick(emitClose, this);
	        }
	      });
	    }

	    cb(ws, req);
	  }
	}

	websocketServer = WebSocketServer;

	/**
	 * Add event listeners on an `EventEmitter` using a map of <event, listener>
	 * pairs.
	 *
	 * @param {EventEmitter} server The event emitter
	 * @param {Object.<String, Function>} map The listeners to add
	 * @return {Function} A function that will remove the added listeners when
	 *     called
	 * @private
	 */
	function addListeners(server, map) {
	  for (const event of Object.keys(map)) server.on(event, map[event]);

	  return function removeListeners() {
	    for (const event of Object.keys(map)) {
	      server.removeListener(event, map[event]);
	    }
	  };
	}

	/**
	 * Emit a `'close'` event on an `EventEmitter`.
	 *
	 * @param {EventEmitter} server The event emitter
	 * @private
	 */
	function emitClose(server) {
	  server._state = CLOSED;
	  server.emit('close');
	}

	/**
	 * Handle socket errors.
	 *
	 * @private
	 */
	function socketOnError() {
	  this.destroy();
	}

	/**
	 * Close the connection when preconditions are not fulfilled.
	 *
	 * @param {Duplex} socket The socket of the upgrade request
	 * @param {Number} code The HTTP response status code
	 * @param {String} [message] The HTTP response body
	 * @param {Object} [headers] Additional HTTP response headers
	 * @private
	 */
	function abortHandshake(socket, code, message, headers) {
	  //
	  // The socket is writable unless the user destroyed or ended it before calling
	  // `server.handleUpgrade()` or in the `verifyClient` function, which is a user
	  // error. Handling this does not make much sense as the worst that can happen
	  // is that some of the data written by the user might be discarded due to the
	  // call to `socket.end()` below, which triggers an `'error'` event that in
	  // turn causes the socket to be destroyed.
	  //
	  message = message || http.STATUS_CODES[code];
	  headers = {
	    Connection: 'close',
	    'Content-Type': 'text/html',
	    'Content-Length': Buffer.byteLength(message),
	    ...headers
	  };

	  socket.once('finish', socket.destroy);

	  socket.end(
	    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\n` +
	      Object.keys(headers)
	        .map((h) => `${h}: ${headers[h]}`)
	        .join('\r\n') +
	      '\r\n\r\n' +
	      message
	  );
	}

	/**
	 * Emit a `'wsClientError'` event on a `WebSocketServer` if there is at least
	 * one listener for it, otherwise call `abortHandshake()`.
	 *
	 * @param {WebSocketServer} server The WebSocket server
	 * @param {http.IncomingMessage} req The request object
	 * @param {Duplex} socket The socket of the upgrade request
	 * @param {Number} code The HTTP response status code
	 * @param {String} message The HTTP response body
	 * @param {Object} [headers] The HTTP response headers
	 * @private
	 */
	function abortHandshakeOrEmitwsClientError(
	  server,
	  req,
	  socket,
	  code,
	  message,
	  headers
	) {
	  if (server.listenerCount('wsClientError')) {
	    const err = new Error(message);
	    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);

	    server.emit('wsClientError', err, socket, req);
	  } else {
	    abortHandshake(socket, code, message, headers);
	  }
	}
	return websocketServer;
}

requireWebsocketServer();

const log$1 = (message, options = { type: 'info' }) => {
    log$2(message, { ...options, source: 'AlpacaMarketDataAPI' });
};
// Default settings for market data API
const DEFAULT_ADJUSTMENT = 'all';
const DEFAULT_FEED = 'sip';
const DEFAULT_CURRENCY = 'USD';
/**
 * Singleton class for interacting with Alpaca Market Data API
 * Provides methods for fetching historical bars, latest bars, last trades, latest trades, latest quotes, and latest quote for a single symbol
 */
class AlpacaMarketDataAPI extends EventEmitter {
    static instance;
    headers;
    dataURL;
    apiURL;
    v1beta1url;
    stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/sip'; // production values
    optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options'; // production values
    cryptoStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us'; // production values
    stockWs = null;
    optionWs = null;
    cryptoWs = null;
    stockSubscriptions = { trades: [], quotes: [], bars: [] };
    optionSubscriptions = { trades: [], quotes: [], bars: [] };
    cryptoSubscriptions = { trades: [], quotes: [], bars: [] };
    setMode(mode = 'production') {
        if (mode === 'sandbox') { // sandbox mode
            this.stockStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v2/sip';
            this.optionStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v1beta3/options';
            this.cryptoStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v1beta3/crypto/us';
        }
        else if (mode === 'test') { // test mode, can only use ticker FAKEPACA
            this.stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/test';
            this.optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options'; // there's no test mode for options
            this.cryptoStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us'; // there's no test mode for crypto
        }
        else { // production
            this.stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/sip';
            this.optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options';
            this.cryptoStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us';
        }
    }
    getMode() {
        if (this.stockStreamUrl.includes('sandbox')) {
            return 'sandbox';
        }
        else if (this.stockStreamUrl.includes('test')) {
            return 'test';
        }
        else {
            return 'production';
        }
    }
    constructor() {
        super();
        this.dataURL = 'https://data.alpaca.markets/v2';
        this.apiURL =
            process.env.ALPACA_ACCOUNT_TYPE === 'PAPER'
                ? 'https://paper-api.alpaca.markets/v2'
                : 'https://api.alpaca.markets/v2'; // used by some, e.g. getAssets
        this.v1beta1url = 'https://data.alpaca.markets/v1beta1'; // used for options endpoints
        this.setMode('production'); // sets stockStreamUrl and optionStreamUrl
        this.headers = {
            'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
            'Content-Type': 'application/json',
        };
    }
    static getInstance() {
        if (!AlpacaMarketDataAPI.instance) {
            AlpacaMarketDataAPI.instance = new AlpacaMarketDataAPI();
        }
        return AlpacaMarketDataAPI.instance;
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    connect(streamType) {
        let url;
        if (streamType === 'stock') {
            url = this.stockStreamUrl;
        }
        else if (streamType === 'option') {
            url = this.optionStreamUrl;
        }
        else {
            url = this.cryptoStreamUrl;
        }
        const ws = new WebSocket(url);
        if (streamType === 'stock') {
            this.stockWs = ws;
        }
        else if (streamType === 'option') {
            this.optionWs = ws;
        }
        else {
            this.cryptoWs = ws;
        }
        ws.on('open', () => {
            log$1(`${streamType} stream connected`, { type: 'info' });
            const authMessage = {
                action: 'auth',
                key: process.env.ALPACA_API_KEY,
                secret: process.env.ALPACA_SECRET_KEY,
            };
            ws.send(JSON.stringify(authMessage));
        });
        ws.on('message', (data) => {
            const messages = JSON.parse(data.toString());
            for (const message of messages) {
                if (message.T === 'success' && message.msg === 'authenticated') {
                    log$1(`${streamType} stream authenticated`, { type: 'info' });
                    this.sendSubscription(streamType);
                }
                else if (message.T === 'error') {
                    log$1(`${streamType} stream error: ${message.msg} (code: ${message.code})`, { type: 'error' });
                }
                else if (message.S) {
                    super.emit(`${streamType}-${message.T}`, message);
                    super.emit(`${streamType}-data`, message);
                }
            }
        });
        ws.on('close', () => {
            log$1(`${streamType} stream disconnected`, { type: 'warn' });
            if (streamType === 'stock') {
                this.stockWs = null;
            }
            else if (streamType === 'option') {
                this.optionWs = null;
            }
            else {
                this.cryptoWs = null;
            }
            // Optional: implement reconnect logic
        });
        ws.on('error', (error) => {
            log$1(`${streamType} stream error: ${error.message}`, { type: 'error' });
        });
    }
    sendSubscription(streamType) {
        let ws;
        let subscriptions;
        if (streamType === 'stock') {
            ws = this.stockWs;
            subscriptions = this.stockSubscriptions;
        }
        else if (streamType === 'option') {
            ws = this.optionWs;
            subscriptions = this.optionSubscriptions;
        }
        else {
            ws = this.cryptoWs;
            subscriptions = this.cryptoSubscriptions;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            const subMessagePayload = {};
            if (subscriptions.trades.length > 0) {
                subMessagePayload.trades = subscriptions.trades;
            }
            if (subscriptions.quotes.length > 0) {
                subMessagePayload.quotes = subscriptions.quotes;
            }
            if (subscriptions.bars.length > 0) {
                subMessagePayload.bars = subscriptions.bars;
            }
            if (Object.keys(subMessagePayload).length > 0) {
                const subMessage = {
                    action: 'subscribe',
                    ...subMessagePayload,
                };
                ws.send(JSON.stringify(subMessage));
            }
        }
    }
    connectStockStream() {
        if (!this.stockWs) {
            this.connect('stock');
        }
    }
    connectOptionStream() {
        if (!this.optionWs) {
            this.connect('option');
        }
    }
    connectCryptoStream() {
        if (!this.cryptoWs) {
            this.connect('crypto');
        }
    }
    disconnectStockStream() {
        if (this.stockWs) {
            this.stockWs.close();
        }
    }
    disconnectOptionStream() {
        if (this.optionWs) {
            this.optionWs.close();
        }
    }
    disconnectCryptoStream() {
        if (this.cryptoWs) {
            this.cryptoWs.close();
        }
    }
    /**
     * Check if a specific stream is connected
     * @param streamType - The type of stream to check
     * @returns True if the stream is connected
     */
    isStreamConnected(streamType) {
        if (streamType === 'stock') {
            return this.stockWs !== null && this.stockWs.readyState === WebSocket.OPEN;
        }
        else if (streamType === 'option') {
            return this.optionWs !== null && this.optionWs.readyState === WebSocket.OPEN;
        }
        else {
            return this.cryptoWs !== null && this.cryptoWs.readyState === WebSocket.OPEN;
        }
    }
    subscribe(streamType, subscriptions) {
        let currentSubscriptions;
        if (streamType === 'stock') {
            currentSubscriptions = this.stockSubscriptions;
        }
        else if (streamType === 'option') {
            currentSubscriptions = this.optionSubscriptions;
        }
        else {
            currentSubscriptions = this.cryptoSubscriptions;
        }
        Object.entries(subscriptions).forEach(([key, value]) => {
            if (value) {
                currentSubscriptions[key] = [...new Set([...(currentSubscriptions[key] || []), ...value])];
            }
        });
        this.sendSubscription(streamType);
    }
    unsubscribe(streamType, subscriptions) {
        let currentSubscriptions;
        if (streamType === 'stock') {
            currentSubscriptions = this.stockSubscriptions;
        }
        else if (streamType === 'option') {
            currentSubscriptions = this.optionSubscriptions;
        }
        else {
            currentSubscriptions = this.cryptoSubscriptions;
        }
        Object.entries(subscriptions).forEach(([key, value]) => {
            if (value) {
                currentSubscriptions[key] = (currentSubscriptions[key] || []).filter(s => !value.includes(s));
            }
        });
        const unsubMessage = {
            action: 'unsubscribe',
            ...subscriptions,
        };
        let ws;
        if (streamType === 'stock') {
            ws = this.stockWs;
        }
        else if (streamType === 'option') {
            ws = this.optionWs;
        }
        else {
            ws = this.cryptoWs;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(unsubMessage));
        }
    }
    async makeRequest(endpoint, method = 'GET', params, baseUrlName = 'data') {
        const baseUrl = baseUrlName === 'data' ? this.dataURL : baseUrlName === 'api' ? this.apiURL : this.v1beta1url;
        const url = new URL(`${baseUrl}${endpoint}`);
        try {
            if (params) {
                Object.entries(params).forEach(([key, value]) => {
                    if (Array.isArray(value)) {
                        url.searchParams.append(key, value.join(','));
                    }
                    else if (value !== undefined) {
                        url.searchParams.append(key, value.toString());
                    }
                });
            }
            const response = await fetch(url.toString(), {
                method,
                headers: this.headers,
            });
            if (!response.ok) {
                const errorText = await response.text();
                log$1(`Market Data API error (${response.status}): ${errorText}`, { type: 'error' });
                throw new Error(`Market Data API error (${response.status}): ${errorText}`);
            }
            const data = await response.json();
            return data;
        }
        catch (err) {
            const error = err;
            log$1(`Error in makeRequest: ${error.message}. Endpoint: ${endpoint}. Url: ${url.toString()}`, { type: 'error' });
            if (error instanceof TypeError) {
                log$1(`Network error details: ${error.stack}`, { type: 'error' });
            }
            throw error;
        }
    }
    /**
     * Get historical OHLCV bars for specified symbols, including pre-market and post-market data
     * Automatically handles pagination to fetch all available data
     * @param params Parameters for historical bars request
     * @returns Historical bars data with all pages combined
     */
    async getHistoricalBars(params) {
        const symbols = params.symbols;
        const symbolsStr = symbols.join(',');
        let allBars = {};
        let pageToken = null;
        let hasMorePages = true;
        let totalBarsCount = 0;
        let pageCount = 0;
        let currency = '';
        // Initialize bar arrays for each symbol
        symbols.forEach(symbol => {
            allBars[symbol] = [];
        });
        log$1(`Starting historical bars fetch for ${symbolsStr} (${params.timeframe}, ${params.start || 'no start'} to ${params.end || 'no end'})`, {
            type: 'info'
        });
        while (hasMorePages) {
            pageCount++;
            const requestParams = {
                ...params,
                adjustment: DEFAULT_ADJUSTMENT,
                feed: DEFAULT_FEED,
                ...(pageToken && { page_token: pageToken }),
            };
            const response = await this.makeRequest('/stocks/bars', 'GET', requestParams);
            if (!response.bars) {
                log$1(`No bars data found in response for ${symbolsStr}`, { type: 'warn' });
                break;
            }
            // Track currency from first response
            if (!currency) {
                currency = response.currency;
            }
            // Combine bars for each symbol
            let pageBarsCount = 0;
            let earliestTimestamp = null;
            let latestTimestamp = null;
            Object.entries(response.bars).forEach(([symbol, bars]) => {
                if (bars && bars.length > 0) {
                    allBars[symbol] = [...allBars[symbol], ...bars];
                    pageBarsCount += bars.length;
                    // Track date range for this page
                    bars.forEach(bar => {
                        const barDate = new Date(bar.t);
                        if (!earliestTimestamp || barDate < earliestTimestamp) {
                            earliestTimestamp = barDate;
                        }
                        if (!latestTimestamp || barDate > latestTimestamp) {
                            latestTimestamp = barDate;
                        }
                    });
                }
            });
            totalBarsCount += pageBarsCount;
            pageToken = response.next_page_token || null;
            hasMorePages = !!pageToken;
            // Enhanced logging with date range and progress info
            const dateRangeStr = earliestTimestamp && latestTimestamp
                ? `${earliestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${latestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
                : 'unknown range';
            log$1(`Page ${pageCount}: Fetched ${pageBarsCount.toLocaleString()} bars (total: ${totalBarsCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
                type: 'info'
            });
            // Prevent infinite loops
            if (pageCount > 1000) {
                log$1(`Stopping pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
                break;
            }
        }
        // Final summary
        const symbolCounts = Object.entries(allBars).map(([symbol, bars]) => `${symbol}: ${bars.length}`).join(', ');
        log$1(`Historical bars fetch complete: ${totalBarsCount.toLocaleString()} total bars across ${pageCount} pages (${symbolCounts})`, {
            type: 'info'
        });
        return {
            bars: allBars,
            next_page_token: null, // Always null since we fetch all pages
            currency: currency || DEFAULT_CURRENCY,
        };
    }
    /**
     * Get the most recent minute bar for requested symbols
     * @param symbols Array of stock symbols to query
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest bar data for each symbol
     
     */
    async getLatestBars(symbols, currency) {
        return this.makeRequest('/stocks/bars/latest', 'GET', {
            symbols,
            feed: DEFAULT_FEED,
            currency: currency || DEFAULT_CURRENCY,
        });
    }
    /**
     * Get the last trade for a single symbol
     * @param symbol The stock symbol to query
     * @returns Last trade details including price, size, exchange, and conditions
     */
    async getLastTrade(symbol) {
        return this.makeRequest(`/v1/last/stocks/${symbol}`, 'GET');
    }
    /**
     * Get the most recent trades for requested symbols
     * @param symbols Array of stock symbols to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest trade data for each symbol
     
     */
    async getLatestTrades(symbols, feed, currency) {
        return this.makeRequest('/stocks/trades/latest', 'GET', {
            symbols,
            feed: feed || DEFAULT_FEED,
            currency: currency || DEFAULT_CURRENCY,
        });
    }
    /**
     * Get the most recent quotes for requested symbols
     * @param symbols Array of stock symbols to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest quote data for each symbol
     */
    async getLatestQuotes(symbols, feed, currency) {
        // Return empty response if symbols array is empty to avoid API error
        if (!symbols || symbols.length === 0) {
            log$1('No symbols provided to getLatestQuotes, returning empty response', { type: 'warn' });
            return {
                quotes: {},
                currency: currency || DEFAULT_CURRENCY,
            };
        }
        return this.makeRequest('/stocks/quotes/latest', 'GET', {
            symbols,
            feed: feed || DEFAULT_FEED,
            currency: currency || DEFAULT_CURRENCY,
        });
    }
    /**
     * Get the latest quote for a single symbol
     * @param symbol The stock symbol to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest quote data with symbol and currency information
     */
    async getLatestQuote(symbol, feed, currency) {
        return this.makeRequest(`/stocks/${symbol}/quotes/latest`, 'GET', {
            feed: feed || DEFAULT_FEED,
            currency,
        });
    }
    /**
     * Get the previous day's closing price for a symbol
     * @param symbol The stock symbol to query
     * @param referenceDate Optional reference date to get the previous close for
     * @returns Previous day's closing price data
     */
    async getPreviousClose(symbol, referenceDate) {
        const date = referenceDate || new Date();
        const prevMarketDate = getLastFullTradingDate(date);
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Day',
            start: prevMarketDate.date.toISOString(),
            end: prevMarketDate.date.toISOString(),
            limit: 1,
        });
        if (!response.bars[symbol] || response.bars[symbol].length === 0) {
            log$1(`No previous close data available for ${symbol}`, { type: 'error', symbol });
            return null;
        }
        return response.bars[symbol][0];
    }
    /**
     * Get hourly price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of hourly price bars
     */
    async getHourlyPrices(symbol, start, end) {
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Hour',
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            limit: 96, // Last 96 hours (4 days)
        });
        return response.bars[symbol] || [];
    }
    /**
     * Get half-hourly price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of half-hourly price bars
     */
    async getHalfHourlyPrices(symbol, start, end) {
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '30Min',
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            limit: 16 * 2 * 4, // last 4 days, 16 hours per day, 2 bars per hour
        });
        return response.bars[symbol] || [];
    }
    /**
     * Get daily price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of daily price bars
     */
    async getDailyPrices(symbol, start, end) {
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Day',
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            limit: 100, // Last 100 days
        });
        return response.bars[symbol] || [];
    }
    /**
     * Get intraday price data for a symbol
     * @param symbol The stock symbol to query
     * @param minutePeriod Minutes per bar (1, 5, 15, etc.)
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of intraday price bars
     */
    async getIntradayPrices(symbol, minutePeriod, start, end) {
        const timeframe = `${minutePeriod}Min`;
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
        });
        return response.bars[symbol] || [];
    }
    /**
     * Analyzes an array of price bars and returns a summary string
     * @param bars Array of price bars to analyze
     * @returns A string summarizing the price data
     */
    static analyzeBars(bars) {
        if (!bars || bars.length === 0) {
            return 'No price data available';
        }
        const firstBar = bars[0];
        const lastBar = bars[bars.length - 1];
        const priceChange = lastBar.c - firstBar.o;
        const percentChange = (priceChange / firstBar.o) * 100;
        const volumeChange = lastBar.v - firstBar.v;
        const percentVolumeChange = (volumeChange / firstBar.v) * 100;
        const high = Math.max(...bars.map((bar) => bar.h));
        const low = Math.min(...bars.map((bar) => bar.l));
        const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
        const avgVolume = totalVolume / bars.length;
        return (`Price: $${firstBar.o.toFixed(2)} -> $${lastBar.c.toFixed(2)} (${percentChange.toFixed(2)}%), ` +
            `Volume: ${firstBar.v.toLocaleString()} -> ${lastBar.v.toLocaleString()} (${percentVolumeChange.toFixed(2)}%), ` +
            `High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, ` +
            `Avg Volume: ${avgVolume.toLocaleString()}`);
    }
    /**
     * Get all assets available for trade and data consumption from Alpaca
     * @param params Optional query params: status (e.g. 'active'), asset_class (e.g. 'us_equity', 'crypto')
     * @returns Array of AlpacaAsset objects
     * @see https://docs.alpaca.markets/reference/get-v2-assets-1
     */
    async getAssets(params) {
        // Endpoint: GET /v2/assets
        return this.makeRequest('/assets', 'GET', params, 'api'); // use apiURL
    }
    /**
     * Get a single asset by symbol or asset_id
     * @param symbolOrAssetId Symbol or asset_id
     * @returns AlpacaAsset object
     * @see https://docs.alpaca.markets/reference/get-v2-assets-symbol_or_asset_id
     */
    async getAsset(symbolOrAssetId) {
        // Endpoint: GET /v2/assets/{symbol_or_asset_id}
        return this.makeRequest(`/assets/${encodeURIComponent(symbolOrAssetId)}`, 'GET', undefined, 'api');
    }
    // ===== OPTIONS MARKET DATA METHODS =====
    /**
     * Get options chain for an underlying symbol
     * Provides the latest trade, latest quote, and greeks for each contract symbol of the underlying symbol
     * @param params Options chain request parameters
     * @returns Options chain data with snapshots for each contract
     * @see https://docs.alpaca.markets/reference/optionchain
     */
    async getOptionsChain(params) {
        const { underlying_symbol, ...queryParams } = params;
        return this.makeRequest(`/options/snapshots/${encodeURIComponent(underlying_symbol)}`, 'GET', queryParams, 'v1beta1');
    }
    /**
     * Get the most recent trades for requested option contract symbols
     * @param params Latest options trades request parameters
     * @returns Latest trade data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionlatesttrades
     */
    async getLatestOptionsTrades(params) {
        // Remove limit and page_token as they're not supported by this endpoint
        const { limit, page_token, ...requestParams } = params;
        return this.makeRequest('/options/trades/latest', 'GET', requestParams, 'v1beta1');
    }
    /**
     * Get the most recent quotes for requested option contract symbols
     * @param params Latest options quotes request parameters
     * @returns Latest quote data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionlatestquotes
     */
    async getLatestOptionsQuotes(params) {
        // Remove limit and page_token as they're not supported by this endpoint
        const { limit, page_token, ...requestParams } = params;
        return this.makeRequest('/options/quotes/latest', 'GET', requestParams, 'v1beta1');
    }
    /**
     * Get historical OHLCV bars for option contract symbols
     * Automatically handles pagination to fetch all available data
     * @param params Historical options bars request parameters
     * @returns Historical bar data for each option contract symbol with all pages combined
     
     * @see https://docs.alpaca.markets/reference/optionbars
     */
    async getHistoricalOptionsBars(params) {
        const symbols = params.symbols;
        const symbolsStr = symbols.join(',');
        let allBars = {};
        let pageToken = null;
        let hasMorePages = true;
        let totalBarsCount = 0;
        let pageCount = 0;
        // Initialize bar arrays for each symbol
        symbols.forEach(symbol => {
            allBars[symbol] = [];
        });
        log$1(`Starting historical options bars fetch for ${symbolsStr} (${params.timeframe}, ${params.start || 'no start'} to ${params.end || 'no end'})`, {
            type: 'info'
        });
        while (hasMorePages) {
            pageCount++;
            const requestParams = {
                ...params,
                ...(pageToken && { page_token: pageToken }),
            };
            const response = await this.makeRequest('/options/bars', 'GET', requestParams, 'v1beta1');
            if (!response.bars) {
                log$1(`No options bars data found in response for ${symbolsStr}`, { type: 'warn' });
                break;
            }
            // Combine bars for each symbol
            let pageBarsCount = 0;
            let earliestTimestamp = null;
            let latestTimestamp = null;
            Object.entries(response.bars).forEach(([symbol, bars]) => {
                if (bars && bars.length > 0) {
                    allBars[symbol] = [...allBars[symbol], ...bars];
                    pageBarsCount += bars.length;
                    // Track date range for this page
                    bars.forEach(bar => {
                        const barDate = new Date(bar.t);
                        if (!earliestTimestamp || barDate < earliestTimestamp) {
                            earliestTimestamp = barDate;
                        }
                        if (!latestTimestamp || barDate > latestTimestamp) {
                            latestTimestamp = barDate;
                        }
                    });
                }
            });
            totalBarsCount += pageBarsCount;
            pageToken = response.next_page_token || null;
            hasMorePages = !!pageToken;
            // Enhanced logging with date range and progress info
            const dateRangeStr = earliestTimestamp && latestTimestamp
                ? `${earliestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${latestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
                : 'unknown range';
            log$1(`Page ${pageCount}: Fetched ${pageBarsCount.toLocaleString()} option bars (total: ${totalBarsCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
                type: 'info'
            });
            // Prevent infinite loops
            if (pageCount > 1000) {
                log$1(`Stopping options bars pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
                break;
            }
        }
        // Final summary
        const symbolCounts = Object.entries(allBars).map(([symbol, bars]) => `${symbol}: ${bars.length}`).join(', ');
        log$1(`Historical options bars fetch complete: ${totalBarsCount.toLocaleString()} total bars across ${pageCount} pages (${symbolCounts})`, {
            type: 'info'
        });
        return {
            bars: allBars,
            next_page_token: undefined, // Always undefined since we fetch all pages
        };
    }
    /**
     * Get historical trades for option contract symbols
     * Automatically handles pagination to fetch all available data
     * @param params Historical options trades request parameters
     * @returns Historical trade data for each option contract symbol with all pages combined
     
     * @see https://docs.alpaca.markets/reference/optiontrades
     */
    async getHistoricalOptionsTrades(params) {
        const symbols = params.symbols;
        const symbolsStr = symbols.join(',');
        let allTrades = {};
        let pageToken = null;
        let hasMorePages = true;
        let totalTradesCount = 0;
        let pageCount = 0;
        // Initialize trades arrays for each symbol
        symbols.forEach(symbol => {
            allTrades[symbol] = [];
        });
        log$1(`Starting historical options trades fetch for ${symbolsStr} (${params.start || 'no start'} to ${params.end || 'no end'})`, {
            type: 'info'
        });
        while (hasMorePages) {
            pageCount++;
            const requestParams = {
                ...params,
                ...(pageToken && { page_token: pageToken }),
            };
            const response = await this.makeRequest('/options/trades', 'GET', requestParams, 'v1beta1');
            if (!response.trades) {
                log$1(`No options trades data found in response for ${symbolsStr}`, { type: 'warn' });
                break;
            }
            // Combine trades for each symbol
            let pageTradesCount = 0;
            let earliestTimestamp = null;
            let latestTimestamp = null;
            Object.entries(response.trades).forEach(([symbol, trades]) => {
                if (trades && trades.length > 0) {
                    allTrades[symbol] = [...allTrades[symbol], ...trades];
                    pageTradesCount += trades.length;
                    // Track date range for this page
                    trades.forEach(trade => {
                        const tradeDate = new Date(trade.t);
                        if (!earliestTimestamp || tradeDate < earliestTimestamp) {
                            earliestTimestamp = tradeDate;
                        }
                        if (!latestTimestamp || tradeDate > latestTimestamp) {
                            latestTimestamp = tradeDate;
                        }
                    });
                }
            });
            totalTradesCount += pageTradesCount;
            pageToken = response.next_page_token || null;
            hasMorePages = !!pageToken;
            // Enhanced logging with date range and progress info
            const dateRangeStr = earliestTimestamp && latestTimestamp
                ? `${earliestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${latestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
                : 'unknown range';
            log$1(`Page ${pageCount}: Fetched ${pageTradesCount.toLocaleString()} option trades (total: ${totalTradesCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
                type: 'info'
            });
            // Prevent infinite loops
            if (pageCount > 1000) {
                log$1(`Stopping options trades pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
                break;
            }
        }
        // Final summary
        const symbolCounts = Object.entries(allTrades).map(([symbol, trades]) => `${symbol}: ${trades.length}`).join(', ');
        log$1(`Historical options trades fetch complete: ${totalTradesCount.toLocaleString()} total trades across ${pageCount} pages (${symbolCounts})`, {
            type: 'info'
        });
        return {
            trades: allTrades,
            next_page_token: undefined, // Always undefined since we fetch all pages
        };
    }
    /**
     * Get snapshots for option contract symbols
     * Provides latest trade, latest quote, and greeks for each contract symbol
     * @param params Options snapshots request parameters
     * @returns Snapshot data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionsnapshots
     */
    async getOptionsSnapshot(params) {
        // Remove limit and page_token as they may not be supported by this endpoint
        const { limit, page_token, ...requestParams } = params;
        return this.makeRequest('/options/snapshots', 'GET', requestParams, 'v1beta1');
    }
    /**
     * Get condition codes for options trades or quotes
     * Returns the mapping between condition codes and their descriptions
     * @param tickType The type of tick data ('trade' or 'quote')
     * @returns Mapping of condition codes to descriptions
     
     * @see https://docs.alpaca.markets/reference/optionmetaconditions
     */
    async getOptionsConditionCodes(tickType) {
        return this.makeRequest(`/options/meta/conditions/${tickType}`, 'GET', undefined, 'v1beta1');
    }
    /**
     * Get exchange codes for options
     * Returns the mapping between option exchange codes and exchange names
     * @returns Mapping of exchange codes to exchange names
     
     * @see https://docs.alpaca.markets/reference/optionmetaexchanges
     */
    async getOptionsExchangeCodes() {
        return this.makeRequest('/options/meta/exchanges', 'GET', undefined, 'v1beta1');
    }
    /**
     * Analyzes an array of option bars and returns a summary string
     * @param bars Array of option bars to analyze
     * @returns A string summarizing the option price data
     */
    static analyzeOptionBars(bars) {
        if (!bars || bars.length === 0) {
            return 'No option price data available';
        }
        const firstBar = bars[0];
        const lastBar = bars[bars.length - 1];
        const priceChange = lastBar.c - firstBar.o;
        const percentChange = (priceChange / firstBar.o) * 100;
        const volumeChange = lastBar.v - firstBar.v;
        const percentVolumeChange = firstBar.v > 0 ? (volumeChange / firstBar.v) * 100 : 0;
        const high = Math.max(...bars.map((bar) => bar.h));
        const low = Math.min(...bars.map((bar) => bar.l));
        const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
        const avgVolume = totalVolume / bars.length;
        return (`Option Price: $${firstBar.o.toFixed(2)} -> $${lastBar.c.toFixed(2)} (${percentChange.toFixed(2)}%), ` +
            `Volume: ${firstBar.v.toLocaleString()} -> ${lastBar.v.toLocaleString()} (${percentVolumeChange.toFixed(2)}%), ` +
            `High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, ` +
            `Avg Volume: ${avgVolume.toLocaleString()}`);
    }
    /**
     * Formats option greeks for display
     * @param greeks Option greeks object
     * @returns Formatted string with greek values
     */
    static formatOptionGreeks(greeks) {
        if (!greeks) {
            return 'No greeks data available';
        }
        const parts = [];
        if (greeks.delta !== undefined)
            parts.push(`Delta: ${greeks.delta.toFixed(4)}`);
        if (greeks.gamma !== undefined)
            parts.push(`Gamma: ${greeks.gamma.toFixed(4)}`);
        if (greeks.theta !== undefined)
            parts.push(`Theta: ${greeks.theta.toFixed(4)}`);
        if (greeks.vega !== undefined)
            parts.push(`Vega: ${greeks.vega.toFixed(4)}`);
        if (greeks.rho !== undefined)
            parts.push(`Rho: ${greeks.rho.toFixed(4)}`);
        return parts.length > 0 ? parts.join(', ') : 'No greeks data available';
    }
    /**
     * Interprets condition codes using the provided condition codes mapping
     * @param conditionCodes Array of condition codes from trade or quote
     * @param conditionCodesMap Mapping of condition codes to descriptions
     * @returns Formatted string with condition descriptions
     */
    static interpretConditionCodes(conditionCodes, conditionCodesMap) {
        if (!conditionCodes || conditionCodes.length === 0) {
            return 'No conditions';
        }
        const descriptions = conditionCodes
            .map((code) => conditionCodesMap[code] || `Unknown (${code})`)
            .filter((desc) => desc !== undefined);
        return descriptions.length > 0 ? descriptions.join(', ') : 'No condition descriptions available';
    }
    /**
     * Gets the exchange name from exchange code using the provided exchange codes mapping
     * @param exchangeCode Exchange code from trade or quote
     * @param exchangeCodesMap Mapping of exchange codes to names
     * @returns Exchange name or formatted unknown exchange
     */
    static getExchangeName(exchangeCode, exchangeCodesMap) {
        return exchangeCodesMap[exchangeCode] || `Unknown Exchange (${exchangeCode})`;
    }
    /**
     * Fetches news articles from Alpaca API for a symbol, paginating through all results.
     * @param symbol The symbol to fetch news for (e.g., 'AAPL')
     * @param params Optional parameters: start, end, limit, sort, include_content
     * @returns Array of SimpleNews articles
     */
    async fetchNews(symbol, params) {
        const defaultParams = {
            start: new Date(Date.now() - 24 * 60 * 60 * 1000),
            end: new Date(),
            limit: 10,
            sort: 'desc',
            include_content: true,
        };
        const mergedParams = { ...defaultParams, ...params };
        let newsArticles = [];
        let pageToken = null;
        let hasMorePages = true;
        let fetchedCount = 0;
        const maxLimit = mergedParams.limit;
        // Utility to clean content
        function cleanContent(content) {
            if (!content)
                return undefined;
            // Remove excessive whitespace, newlines, and trim
            return content.replace(/\s+/g, ' ').trim();
        }
        while (hasMorePages) {
            const queryParams = new URLSearchParams({
                ...(mergedParams.start && { start: new Date(mergedParams.start).toISOString() }),
                ...(mergedParams.end && { end: new Date(mergedParams.end).toISOString() }),
                ...(symbol && { symbols: symbol }),
                ...(mergedParams.limit && { limit: Math.min(50, maxLimit - fetchedCount).toString() }),
                ...(mergedParams.sort && { sort: mergedParams.sort }),
                ...(mergedParams.include_content !== undefined ? { include_content: mergedParams.include_content.toString() } : {}),
                ...(pageToken && { page_token: pageToken }),
            });
            const url = `${this.v1beta1url}/news?${queryParams}`;
            log$1(`Fetching news from: ${url}`, { type: 'debug', symbol });
            const response = await fetch(url, {
                method: 'GET',
                headers: this.headers,
            });
            if (!response.ok) {
                const errorText = await response.text();
                log$1(`Alpaca news API error (${response.status}): ${errorText}`, { type: 'error', symbol });
                throw new Error(`Alpaca news API error (${response.status}): ${errorText}`);
            }
            const data = await response.json();
            if (!data.news || !Array.isArray(data.news)) {
                log$1(`No news data found in Alpaca response for ${symbol}`, { type: 'warn', symbol });
                break;
            }
            const transformedNews = data.news.map((article) => ({
                symbols: article.symbols,
                title: article.headline,
                summary: cleanContent(article.summary) ?? '',
                content: article.content ? cleanContent(article.content) : undefined,
                url: article.url,
                source: article.source,
                author: article.author,
                date: article.updated_at || article.created_at,
                updatedDate: article.updated_at || article.created_at,
                sentiment: 0,
            }));
            newsArticles = newsArticles.concat(transformedNews);
            fetchedCount = newsArticles.length;
            pageToken = data.next_page_token || null;
            hasMorePages = !!pageToken && (!maxLimit || fetchedCount < maxLimit);
            log$1(`Fetched ${transformedNews.length} news articles (total: ${fetchedCount}) for ${symbol}. More pages: ${hasMorePages}`, { type: 'debug', symbol });
            if (maxLimit && fetchedCount >= maxLimit) {
                newsArticles = newsArticles.slice(0, maxLimit);
                break;
            }
        }
        return newsArticles;
    }
}
// Export the singleton instance
const marketDataAPI = AlpacaMarketDataAPI.getInstance();

// format-tools.ts
/**
 * Capitalizes the first letter of a string
 * @param {string} str - The string to capitalize
 * @returns {string} The capitalized string, or original value if not a string
 * @example
 * capitalize('hello') // 'Hello'
 * capitalize(123) // 123
 */
/**
 * Formats a number as US currency
 * @param {number} value - The number to format
 * @returns {string} The formatted currency string (e.g. '$1,234.56')
 * @example
 * formatCurrency(1234.56) // '$1,234.56'
 * formatCurrency(NaN) // '$0.00'
 */
function formatCurrency(value) {
    if (isNaN(value)) {
        return '$0.00';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(value);
}
/**
 * Formats a number with commas
 * @param {number} value - The number to format
 * @returns {string} The formatted number string (e.g. '1,234.56')
 * @example
 * formatNumber(1234.56) // '1,234.56'
 * formatNumber(NaN) // '0'
 */
function formatNumber(value) {
    if (isNaN(value)) {
        return '0';
    }
    return new Intl.NumberFormat('en-US').format(value);
}

const log = (message) => {
    console.log(`[${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}] ${message}`);
};
// async function testCreateEquitiesTrade() {
//   try {
//     log('Starting createEquitiesTrade test...');
//     // Create credentials using environment variables
//     const credentials: AlpacaCredentials = {
//       accountName: 'test',
//       apiKey: process.env.ALPACA_API_KEY || '',
//       apiSecret: process.env.ALPACA_SECRET_KEY || '',
//       type: 'PAPER',
//       orderType: 'market',
//       engine: 'quant'
//     };
//     if (!credentials.apiKey || !credentials.apiSecret) {
//       throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables must be set');
//     }
//     // Create a new instance of the trading API
//     const alpacaAPI = createAlpacaTradingAPI(credentials);
//     // Get current account details
//     const accountDetails = await alpacaAPI.getAccountDetails();
//     log(`Account equity: $${parseFloat(accountDetails.equity).toFixed(2)}`);
//     log(`Buying power: $${parseFloat(accountDetails.buying_power).toFixed(2)}`);
//     const testSymbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN']; // Multiple symbols to avoid wash trade detection
//     const referencePrice = 150.00; // Mock reference price for testing
//     log('=== Testing createEquitiesTrade function ===');
//     // Test 1: Simple market order (long position)
//     log('\n1. Testing simple market order (long)...');
//     try {
//       const order1 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[0], qty: 1, side: 'buy' }
//       );
//       log(`✅ Created simple market buy order: ${order1.id}`);
//     } catch (error) {
//       log(`❌ Failed to create simple market order: ${error}`);
//     }
//     // Test 2: Simple market order (short position)
//     log('\n2. Testing simple market order (short)...');
//     try {
//       const order2 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[1], qty: 1, side: 'sell' }
//       );
//       log(`✅ Created simple market sell order: ${order2.id}`);
//     } catch (error) {
//       log(`❌ Failed to create simple market sell order: ${error}`);
//     }
//     // Test 3: Limit order with percentage-based stop loss (long)
//     log('\n3. Testing limit order with percentage-based stop loss (long)...');
//     try {
//       const order3 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[2], qty: 1, side: 'buy', referencePrice },
//         {
//           type: 'limit',
//           limitPrice: 149.50,
//           useStopLoss: true,
//           stopPercent100: 3.0 // 3% stop loss
//         }
//       );
//       log(`✅ Created limit buy order with stop loss: ${order3.id}`);
//     } catch (error) {
//       log(`❌ Failed to create limit order with stop loss: ${error}`);
//     }
//     // Test 4: Limit order with percentage-based take profit (short)
//     log('\n4. Testing limit order with percentage-based take profit (short)...');
//     try {
//       const order4 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[3], qty: 1, side: 'sell', referencePrice },
//         {
//           type: 'limit',
//           limitPrice: 150.50,
//           useTakeProfit: true,
//           takeProfitPercent100: 2.5 // 2.5% take profit
//         }
//       );
//       log(`✅ Created limit sell order with take profit: ${order4.id}`);
//     } catch (error) {
//       log(`❌ Failed to create limit order with take profit: ${error}`);
//     }
//     // Test 5: Bracket order with both stop loss and take profit (long)
//     log('\n5. Testing bracket order with both stop loss and take profit (long)...');
//     try {
//       const order5 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[4], qty: 1, side: 'buy', referencePrice },
//         {
//           type: 'limit',
//           limitPrice: 149.00,
//           useStopLoss: true,
//           stopPercent100: 4.0, // 4% stop loss
//           useTakeProfit: true,
//           takeProfitPercent100: 6.0 // 6% take profit
//         }
//       );
//       log(`✅ Created bracket order (long): ${order5.id}`);
//     } catch (error) {
//       log(`❌ Failed to create bracket order: ${error}`);
//     }
//     // Test 6: Bracket order with fixed prices (short)
//     log('\n6. Testing bracket order with fixed prices (short)...');
//     try {
//       const order6 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[5], qty: 1, side: 'sell' },
//         {
//           type: 'limit',
//           limitPrice: 151.00,
//           useStopLoss: true,
//           stopPrice: 155.00, // Fixed stop price
//           useTakeProfit: true,
//           takeProfitPrice: 145.00 // Fixed take profit price
//         }
//       );
//       log(`✅ Created bracket order with fixed prices (short): ${order6.id}`);
//     } catch (error) {
//       log(`❌ Failed to create bracket order with fixed prices: ${error}`);
//     }
//     // Test 7: Extended hours limit order
//     log('\n7. Testing extended hours limit order...');
//     try {
//       const order7 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[6], qty: 1, side: 'buy' },
//         {
//           type: 'limit',
//           limitPrice: 148.00,
//           extendedHours: true
//         }
//       );
//       log(`✅ Created extended hours limit order: ${order7.id}`);
//     } catch (error) {
//       log(`❌ Failed to create extended hours order: ${error}`);
//     }
//     // Test 8: Error condition - market order with extended hours (should fail)
//     log('\n8. Testing error condition - market order with extended hours (should fail)...');
//     try {
//       await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[0], qty: 1, side: 'buy' },
//         {
//           type: 'market',
//           extendedHours: true // This should trigger an error
//         }
//       );
//       log(`❌ Unexpected success - should have failed!`);
//     } catch (error) {
//       log(`✅ Correctly caught error: ${error instanceof Error ? error.message : error}`);
//     }
//     // Test 9: Error condition - missing referencePrice for percentage (should fail)
//     log('\n9. Testing error condition - missing referencePrice for percentage (should fail)...');
//     try {
//       await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[0], qty: 1, side: 'buy' }, // No referencePrice
//         {
//           useStopLoss: true,
//           stopPercent100: 3.0 // Requires referencePrice
//         }
//       );
//       log(`❌ Unexpected success - should have failed!`);
//     } catch (error) {
//       log(`✅ Correctly caught error: ${error instanceof Error ? error.message : error}`);
//     }
//     // Wait a moment for all orders to process
//     await new Promise(resolve => setTimeout(resolve, 2000));
//     // Get all orders to see what was created
//     log('\n=== Checking created orders ===');
//     const orders = await alpacaAPI.getOrders({ status: 'open', limit: 20 });
//     log(`Found ${orders.length} open orders`);
//     orders.forEach((order, index) => {
//       log(`Order ${index + 1}: ${order.order_class} ${order.type} ${order.side} ${order.qty} ${order.symbol} @ $${order.limit_price || 'market'}`);
//       if (order.legs && order.legs.length > 0) {
//         log(`  Stop Loss: $${order.legs.find(leg => leg.type === 'stop')?.stop_price || 'N/A'}`);
//         log(`  Take Profit: $${order.legs.find(leg => leg.type === 'limit')?.limit_price || 'N/A'}`);
//       }
//     });
//     // Cancel all orders to clean up
//     log('\n=== Cleaning up - canceling all orders ===');
//     await alpacaAPI.cancelAllOrders();
//     log('✅ All orders canceled');
//     log('\n=== Test completed successfully! ===');
//   } catch (error) {
//     log(`❌ Error in createEquitiesTrade test: ${error instanceof Error ? error.message : 'Unknown error'}`);
//     process.exit(1);
//   }
// }
// async function testAlpacaWebSocket() {
//   try {
//     log('Starting Alpaca WebSocket test...');
//     // Create credentials using environment variables
//     const credentials: AlpacaCredentials = {
//       accountName: 'test',
//       apiKey: process.env.ALPACA_API_KEY || '',
//       apiSecret: process.env.ALPACA_SECRET_KEY || '',
//       type: 'PAPER',
//       orderType: 'market',
//       engine: 'quant'
//     };
//     if (!credentials.apiKey || !credentials.apiSecret) {
//       throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables must be set');
//     }
//     // Create a new instance of the trading API
//     const alpacaAPI = createAlpacaTradingAPI(credentials); // type AlpacaCredentials
//     // Set up trade update callback
//     alpacaAPI.onTradeUpdate((update: TradeUpdate) => {
//       log(`Received trade update: event ${update.event} for an order to ${update.order.side} ${update.order.qty} of ${update.order.symbol}`);
//     });
//     // Connect to WebSocket
//     alpacaAPI.connectWebsocket(); // necessary to connect to the WebSocket
//     // create an order
//     const order = await alpacaAPI.createMarketOrder('AAPL', 1, 'buy', 'buy_to_open');
//     // cancel the order
//     await alpacaAPI.cancelAllOrders();
//     // Keep the process running
//     log('WebSocket connected and listening for trade updates...');
//     log('Press Ctrl+C to exit');
//     // Keep the process running
//     await new Promise(() => {});
//   } catch (error) {
//     log(`Error in WebSocket test: ${error instanceof Error ? error.message : 'Unknown error'}`);
//     process.exit(1);
//   }
// }
// // Run the test
// testAlpacaWebSocket();
// Run the createEquitiesTrade test
//testCreateEquitiesTrade();
// testing retrieving pre-market data (just 9:00am to 9:30am on 1 july 2025 for SPY) using the market data api
async function testPreMarketData() {
    try {
        log('Starting pre-market data test for SPY (9:00am-9:30am, July 1, 2025)...');
        // Set up the time range in America/New_York, convert to UTC ISO strings
        const symbol = 'SPY';
        const nyTimeZone = 'America/New_York';
        // 9:00am and 9:30am in NY time
        const startNY = new Date('2025-07-01T09:00:00-04:00');
        const endNY = new Date('2025-07-01T09:30:00-04:00');
        const startUTC = startNY.toISOString();
        const endUTC = endNY.toISOString();
        const barsResponse = await marketDataAPI.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Min',
            start: startUTC,
            end: endUTC,
            limit: 1000,
        });
        const bars = barsResponse.bars[symbol] || [];
        log(`Fetched ${bars.length} 1-min bars for SPY from 9:00am to 9:30am (NY) on 2025-07-01.`);
        if (bars.length === 0) {
            log('No pre-market bars returned.');
            return;
        }
        // Print each bar
        bars.forEach((bar, i) => {
            const barTime = new Date(bar.t).toLocaleString('en-US', { timeZone: nyTimeZone });
            log(`Bar ${i + 1}: ${barTime} | O: ${formatCurrency(bar.o)} H: ${formatCurrency(bar.h)} L: ${formatCurrency(bar.l)} C: ${formatCurrency(bar.c)} V: ${formatNumber(bar.v)} VWAP: ${formatCurrency(bar.vw)} N: ${bar.n}`);
        });
        // Print summary
        const summary = AlpacaMarketDataAPI.analyzeBars(bars);
        if (summary)
            log(`Summary: ${summary}`);
        log('Pre-market data test complete.');
    }
    catch (error) {
        log(`❌ Error in testPreMarketData: ${error instanceof Error ? error.message : error}`);
    }
}
testPreMarketData();
//# sourceMappingURL=test.js.map
