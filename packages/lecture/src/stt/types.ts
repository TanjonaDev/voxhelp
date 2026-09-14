export interface DeepgramUtterance {
  start?: number;
  end?: number;
  confidence?: number;
  transcript?: string;
  speaker?: number;
}
