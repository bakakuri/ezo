// სთორიების დაჯგუფება ავტორებად: ჯერ ჩემი, მერე უნახავი, ბოლოს ნანახი
export function groupStories(rows, myId) {
  const map = new Map()
  for (const s of rows) {
    if (!map.has(s.author_id)) map.set(s.author_id, { author: s.author, items: [] })
    map.get(s.author_id).items.push(s)
  }
  const groups = [...map.values()].map((g) => ({ ...g, seen: g.items.every((i) => i.seen), close: g.items.some((i) => i.audience === 'close' && !i.seen) }))
  const latest = (g) => g.items.reduce((m, i) => (i.created_at > m ? i.created_at : m), '')
  // ჯერ ჩემი, მერე უნახავი (ახლები წინ), ბოლოს ნანახი
  return groups.sort((a, b) => (a.author.id === myId ? -1 : b.author.id === myId ? 1
    : Number(a.seen) - Number(b.seen) || latest(b).localeCompare(latest(a))))
}
