function mergeOptions(bookmarks, toc) {
  return {
    bookmarks: ['retain', 'file', 'group'].includes(bookmarks) ? bookmarks : 'discard',
    toc: ['filename', 'title'].includes(toc) ? toc : 'none'
  };
}

function addsNavigation({ bookmarks, toc }) {
  return bookmarks === 'file' || bookmarks === 'group' || toc !== 'none';
}

module.exports = { mergeOptions, addsNavigation };
