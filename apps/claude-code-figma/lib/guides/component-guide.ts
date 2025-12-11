
interface ComponentPropertyConfig {
  values?: string[] | null;
}

interface ComponentConfig {
  key: string;
  properties?: Record<string, ComponentPropertyConfig | null> | null;
}


const cache = new Map<string, string>();


export const getComponentGuide = (componentName: string): string | null => {
  const cached = cache.get(componentName);
  if (cached) {
    return cached;
  }

  

  return null;
};

export const getComponentGuides = (
  componentNames: string[],
): Record<string, string> => {
  const result: Record<string, string> = {};
  componentNames.forEach((name) => {
    const guide = getComponentGuide(name);
    if (guide) {
      result[name] = guide;
    }
  });
  return result;
};
