const pretendardFonts = [
  { family: "Pretendard", style: "Regular" },
  { family: "Pretendard", style: "Medium" },
  { family: "Pretendard", style: "SemiBold" },
  { family: "Pretendard", style: "Bold" },
  { family: "Pretendard Variable", style: "Regular" },
  { family: "Pretendard Variable", style: "Medium" },
  { family: "Pretendard Variable", style: "SemiBold" },
  { family: "Pretendard Variable", style: "Bold" },
];

export const preloadPretendardFonts = async () => {
  await Promise.all(pretendardFonts.map((font) => figma.loadFontAsync(font)));
};
