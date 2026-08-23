import { Fragment } from "react";

/** Marks every search term inside a line of dialogue, whatever its casing. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(pattern).map((part, index) => (
    terms.some((term) => part.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>
  ))}</>;
}
