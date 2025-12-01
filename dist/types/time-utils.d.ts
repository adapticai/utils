export declare const toUnixTimestamp: (ts: string) => number;
export declare function getTimeAgo(dateString: string): string;
export declare function normalizeDate(timestamp: number): string;
export declare function calculateTimeRange(range: string): string;
export declare const calculateDaysLeft: (accountCreationDate: Date) => number;
export declare const timeAgo: (timestamp?: Date) => string;
export declare const formatDate: (dateString: string, updateDate?: boolean) => string;
export declare const formatDateToString: (date: Date) => string;
export declare const parseETDateFromAV: (dateString: string) => Date;
export declare const formatToUSEastern: (date: Date, justDate?: boolean) => string;
export declare const unixTimetoUSEastern: (timestamp: number) => {
    date: Date;
    timeString: string;
    dateString: string;
};
export declare const timeDiffString: (milliseconds: number) => string;
//# sourceMappingURL=time-utils.d.ts.map