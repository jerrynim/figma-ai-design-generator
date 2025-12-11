export const getRootFrame = (node: any): FrameNode => {
  if (node.parent.type === "PAGE") {
    return node;
  }
  return getRootFrame(node.parent);
};
