// time-utils.ts

import ms from 'ms';
import { fromZonedTime, format } from 'date-fns-tz';

// Helper function to convert timestamp to Unix timestamp in seconds
export const toUnixTimestamp = (ts: string): number => {
  return Math.floor(new Date(ts).getTime() / 1000);
};

export function getTimeAgo(dateString: string) {
  // if format is like this: '20240919T102005', then first convert to '2024-09-19T10:20:05' format

  let dateValue = dateString as string;

  if (dateString && dateString.length === 15) {
    dateValue = dateString.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
  }

  const date = new Date(dateValue);

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);

  if (years > 0) {
    return years === 1 ? '1 year ago' : `${years} years ago`;
  } else if (months > 0) {
    return months === 1 ? '1 month ago' : `${months} months ago`;
  } else if (days > 0) {
    return days === 1 ? '1 day ago' : `${days} days ago`;
  } else if (hours > 0) {
    return hours === 1 ? '1 hr ago' : `${hours} hrs ago`;
  } else if (minutes > 0) {
    return minutes === 1 ? '1 min ago' : `${minutes} mins ago`;
  } else {
    return 'A few seconds ago';
  }
}

export function normalizeDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().split('T')[0]; // Returns 'YYYY-MM-DD'
}

// the function formerly known as CalculateRange, like a camel with two humps. Gross
export function calculateTimeRange(range: string) {
  const currentDate = new Date();

  switch (range) {
    case '1d':
      currentDate.setDate(currentDate.getDate() - 1);
      break;
    case '3d':
      currentDate.setDate(currentDate.getDate() - 3);
      break;
    case '1w':
      currentDate.setDate(currentDate.getDate() - 7);
      break;
    case '1m':
      currentDate.setMonth(currentDate.getMonth() - 1);
      break;
    case '3m':
      currentDate.setMonth(currentDate.getMonth() - 3);
      break;
    case '1y':
      currentDate.setFullYear(currentDate.getFullYear() - 1);
      break;
    default:
      throw new Error(`Invalid range: ${range}`);
  }

  return currentDate.toISOString().split('T')[0]; // format date to 'YYYY-MM-DD'
}

const daysLeft = (accountCreationDate: Date, maxDays: number): number => {
  const now = new Date();
  const endPeriodDate = new Date(accountCreationDate);
  endPeriodDate.setDate(accountCreationDate.getDate() + maxDays);

  const diffInMilliseconds = endPeriodDate.getTime() - now.getTime();

  // Convert milliseconds to days and return
  return Math.ceil(diffInMilliseconds / (1000 * 60 * 60 * 24));
};

const cutoffDate = new Date('2023-10-17T00:00:00.000Z');

export const calculateDaysLeft = (accountCreationDate: Date): number => {
  let maxDays;
  if (accountCreationDate < cutoffDate) {
    maxDays = 30;
    accountCreationDate = new Date('2023-10-01T00:00:00.000Z');
  } else {
    maxDays = 14;
  }
  return daysLeft(accountCreationDate, maxDays);
};

export const timeAgo = (timestamp?: Date): string => {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - new Date(timestamp).getTime();
  if (diff < 60000) {
    // less than 1 second
    return 'Just now';
  } else if (diff > 82800000) {
    // more than 23 hours – similar to how Twitter displays timestamps
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: new Date(timestamp).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  }
  return `${ms(diff)} ago`;
};

// returns date utc
export const formatDate = (dateString: string, updateDate?: boolean) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: updateDate && new Date(dateString).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
};

export const formatDateToString = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
  }) + ', at ' + date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
  });
}

export const parseETDateFromAV = (dateString: string): Date => {
  // Time zone identifier for Eastern Time
  const timeZone = 'America/New_York';

  // Split the input string into date and time components
  const [datePart, timePart] = dateString.split(' ');

  // Construct a full date-time string in ISO format
  const fullString = `${datePart}T${timePart}`;

  // Convert the string to a UTC Date object using date-fns-tz
  const utcDate = fromZonedTime(fullString, timeZone); // Convert to UTC

  return utcDate;
};

export const formatToUSEastern = (date: Date, justDate?: boolean): string => {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };

  if (!justDate) {
    options.hour = 'numeric';
    options.minute = '2-digit';
    options.hour12 = true;
  }

  return date.toLocaleString('en-US', options);
};

export const unixTimetoUSEastern = (timestamp: number): { date: Date; timeString: string; dateString: string } => {
  const date = new Date(timestamp);
  const timeString = formatToUSEastern(date);
  const dateString = formatToUSEastern(date, true);
  return { date, timeString, dateString };
};

export const timeDiffString = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (remainingHours > 0) parts.push(`${remainingHours} hour${remainingHours > 1 ? 's' : ''}`);
  if (remainingMinutes > 0) parts.push(`${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`);

  return parts.join(', ');
};