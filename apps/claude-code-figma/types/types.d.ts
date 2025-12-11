export interface ContextInfo {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  componentKey?: string;
  componentProperties?: Record<string, any>;
  children?: ContextInfo[];
}
