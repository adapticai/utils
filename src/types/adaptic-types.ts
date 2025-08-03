// Use interface for AssetOverview as it may be extended in future and has an index signature
export interface AssetOverview {
  id: string;
  symbol: string;
  [key: string]: any;
}

// Use interface for response types as they follow a consistent pattern and may be extended
export interface AssetOverviewResponse {
  asset: AssetOverview | null;
  error: string | null;
  success: boolean;
}