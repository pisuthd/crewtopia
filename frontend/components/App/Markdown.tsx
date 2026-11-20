'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

/** Markdown for Ember messages: GFM (tables!) + code highlight, compact chat styling. */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-wfnavy prose-p:my-1 prose-p:leading-relaxed prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-wfnavy/15 prose-td:px-2 prose-td:py-1 prose-code:rounded prose-code:bg-wfice prose-code:px-1 prose-code:py-0.5 prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-pre:my-2 prose-pre:rounded-xl prose-pre:bg-wfnavy prose-pre:text-[13px] prose-a:font-semibold prose-a:text-wfcta prose-strong:text-wfnavy prose-headings:my-2 prose-headings:text-wfnavy">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
