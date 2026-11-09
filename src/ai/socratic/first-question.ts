/** Keep the first complete question; quoted question marks belong to its context. */
export function firstSocraticQuestion(text: string): string {
  const quotes: string[] = [];
  const closing: Record<string, string> = { '“': '”', '「': '」', '『': '』', '"': '"' };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quotes.at(-1) === character) quotes.pop();
    else if (closing[character]) quotes.push(closing[character]);
    else if (!quotes.length && (character === '？' || character === '?')) return text.slice(0, index + 1);
  }
  return text;
}
