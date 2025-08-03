// market-hours.ts

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

export const marketHolidays: MarketHolidays = {
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

export const marketEarlyCloses: MarketEarlyCloses = {
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
