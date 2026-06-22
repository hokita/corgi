import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import type { Components } from 'react-markdown'

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-1 mt-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-1 mt-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  pre: ({ children }) => {
    const codeEl = React.Children.toArray(children)[0] as React.ReactElement<{ children: React.ReactNode }>
    return (
      <pre className="bg-gray-900 rounded-lg p-3 overflow-x-auto mb-2">
        <code className="text-gray-100 font-mono text-xs">{codeEl?.props?.children ?? children}</code>
      </pre>
    )
  },
  code: ({ children }) => (
    <code className="bg-gray-100 text-rose-600 px-1 rounded font-mono text-xs">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-400 pl-3 italic text-gray-600 mb-2">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} className="underline text-blue-600" target="_blank" rel="noreferrer">{children}</a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-gray-300 px-2 py-1 font-semibold bg-gray-50">{children}</th>,
  td: ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
  hr: () => <hr className="border-gray-300 my-2" />,
}

interface Props { content: string }

export default function MarkdownMessage({ content }: Props) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
