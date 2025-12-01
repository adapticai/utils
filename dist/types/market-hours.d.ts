export interface HolidayDetails {
    date: string;
}
export interface MarketHolidaysForYear {
    [holidayName: string]: HolidayDetails;
}
export interface MarketHolidays {
    [year: number]: MarketHolidaysForYear;
}
export interface EarlyCloseDetails {
    date: string;
    time: string;
    optionsTime: string;
    notes: string;
}
export interface EarlyClosesForYear {
    [date: string]: EarlyCloseDetails;
}
export interface MarketEarlyCloses {
    [year: number]: EarlyClosesForYear;
}
export declare const marketHolidays: MarketHolidays;
export declare const marketEarlyCloses: MarketEarlyCloses;
//# sourceMappingURL=market-hours.d.ts.map