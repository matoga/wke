import { useMemo } from 'react';
import katex from 'katex';

export function Tex({ math, block = false, className }: { math: string; block?: boolean; className?: string }) {
  const html = useMemo(
    () => katex.renderToString(math, { displayMode: block, throwOnError: false, strict: 'ignore' }),
    [math, block],
  );
  const Tag = block ? 'div' : 'span';
  return <Tag className={block ? `eq ${className ?? ''}` : className} dangerouslySetInnerHTML={{ __html: html }} />;
}
