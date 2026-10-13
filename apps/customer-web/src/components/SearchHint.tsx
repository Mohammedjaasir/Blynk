import { useEffect, useState } from 'react';

const DEFAULT = 'Search groceries & essentials';
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Rolling hint: Search for '<name>' cycling through product names, one line at a time. */
export default function SearchHint({ names }: { names: string[] }) {
  const key = names.join('|');
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [entered, setEntered] = useState(true);
  const count = names.length;
  useEffect(() => {
    if (count < 2 || reduced()) return;
    const t = setInterval(() => {
      setI((n) => { setPrev(n); return (n + 1) % count; });
      setEntered(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    }, 2400);
    return () => clearInterval(t);
  }, [key, count]);
  useEffect(() => {
    if (prev == null) return;
    const t = setTimeout(() => setPrev(null), 450);
    return () => clearTimeout(t);
  }, [prev]);
  const text = (n: number) => (names[n] ? `Search for '${names[n]}'` : DEFAULT);
  return (
    <div className="roll">
      {prev != null && prev !== i && <span className="out" aria-hidden="true">{text(prev)}</span>}
      <span className={entered ? '' : 'in'}>{text(count ? i % count : 0)}</span>
    </div>
  );
}
