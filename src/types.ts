export interface ApiErrorBody {
  code?: number;
  message?: string;
  retry_after?: number | string;
  [key: string]: unknown;
}
