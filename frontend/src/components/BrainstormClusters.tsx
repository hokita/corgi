import type { IdeaCluster } from '../types'

interface Props {
  clusters: IdeaCluster[]
}

export default function BrainstormClusters({ clusters }: Props) {
  return (
    <div className="flex flex-col gap-3 mt-1.5 max-w-[80%]">
      {clusters.map((cluster, i) => (
        <div key={i} className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="font-semibold text-sm text-gray-900 mb-2">{cluster.label}</div>
          <div className="flex flex-col gap-1.5">
            {cluster.ideas.map((idea, j) => (
              <div key={j} className="text-sm text-gray-700">
                <span className="font-medium">{idea.label}</span>
                {' — '}
                <span>{idea.description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
