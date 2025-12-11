interface ContextInfo {
  id: string;
  name: string;
  type: string;
  componentName?: string;
  children?: ContextInfo[];
}
