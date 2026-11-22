// Voice commands (an experiment): turn what was heard into a club or a command.
const WORDS = { three: '3', four: '4', for: '4', five: '5', six: '6', sex: '6', seven: '7', eight: '8', ate: '8', nine: '9', won: '1', one: '1' };
export function parseCommand(text) {
  let t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `;
  t = t.replace(/ ([a-z]+)(?= )/g, (m, w) => (WORDS[w] ? ` ${WORDS[w]}` : m)).replace(/\s+/g, ' ');
  if (/next hole|next whole/.test(t)) return { cmd: 'next' };
  if (/driver|\b1 wood/.test(t)) return { club: 'DR' };
  let m = t.match(/\b([35]) ?(wood|would)/); if (m) return { club: `${m[1]}W` };
  if (/hybrid|rescue/.test(t)) return { club: 'HY' };
  m = t.match(/\b([3-9]) ?(iron|ion|i am|eye on)/); if (m) return { club: `${m[1]}I` };
  if (/pitching|\bp wedge|\bpee wedge/.test(t)) return { club: 'PW' };
  if (/\bgap|\bg wedge/.test(t)) return { club: 'GW' };
  if (/\bsand|\bs wedge/.test(t)) return { club: 'SW' };
  if (/\blob|\bl wedge/.test(t)) return { club: 'LW' };
  return null;
}
