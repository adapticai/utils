export interface AssetOverview {
    id: string;
    symbol: string;
    [key: string]: any;
}
export interface AssetOverviewResponse {
    asset: AssetOverview | null;
    error: string | null;
    success: boolean;
}
//# sourceMappingURL=adaptic-types.d.ts.map