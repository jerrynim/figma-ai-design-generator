export const getNodeSummarize = async (
  node: SceneNode,
): Promise<ContextInfo> => {
  const baseInfo: ContextInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.type === "INSTANCE" && {
      componentName: node.mainComponent?.name,
    }),
  };

  // children이 있으면 재귀적으로 처리
  if ("children" in node && node.children) {
    baseInfo.children = await Promise.all(
      node.children.map((child: SceneNode) => getNodeSummarize(child)),
    );
  }

  return baseInfo;
};
