const simplifiedChineseName =
  /\u7b80\u4f53|\u7b80\u4e2d|\u7b80\u7e41|chinese[\s._-]*simplified|simplified[\s._-]*chinese/i
const simplifiedChineseToken =
  /(?:^|[^a-z0-9])(?:zh[\s._-]*(?:cn|hans)|chs|gb)(?:$|[^a-z0-9])/i
const traditionalChineseName =
  /\u7e41\u4f53|\u7e41\u4e2d|\u6b63\u9ad4|chinese[\s._-]*traditional|traditional[\s._-]*chinese/i
const traditionalChineseToken =
  /(?:^|[^a-z0-9])(?:zh[\s._-]*(?:tw|hk|hant)|cht|big5)(?:$|[^a-z0-9])/i

const subtitleLanguagePriority = (name: string) => {
  if (simplifiedChineseName.test(name) || simplifiedChineseToken.test(name)) {
    return 0
  }
  if (traditionalChineseName.test(name) || traditionalChineseToken.test(name)) {
    return 1
  }
  return 2
}

export const sortSubtitlesByLanguage = <T extends { name: string }>(
  subtitles: readonly T[],
) =>
  subtitles
    .map((subtitle, index) => ({
      subtitle,
      index,
      priority: subtitleLanguagePriority(subtitle.name),
    }))
    .sort((left, right) =>
      left.priority === right.priority
        ? left.index - right.index
        : left.priority - right.priority,
    )
    .map(({ subtitle }) => subtitle)
