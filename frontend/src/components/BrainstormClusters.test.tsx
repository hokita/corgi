import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BrainstormClusters from './BrainstormClusters'
import type { IdeaCluster } from '../types'

const clusters: IdeaCluster[] = [
  {
    label: 'Product Ideas',
    ideas: [
      { label: 'Subscription box', description: 'Curated monthly delivery targeting hobbyists' },
      { label: 'Mobile app', description: 'On-demand access with push notifications' },
    ],
  },
  {
    label: 'Marketing',
    ideas: [
      { label: 'Social media', description: 'Instagram campaigns targeting Gen Z' },
    ],
  },
]

describe('BrainstormClusters', () => {
  it('renders cluster labels as headings', () => {
    render(<BrainstormClusters clusters={clusters} />)
    expect(screen.getByText('Product Ideas')).toBeInTheDocument()
    expect(screen.getByText('Marketing')).toBeInTheDocument()
  })

  it('renders idea labels', () => {
    render(<BrainstormClusters clusters={clusters} />)
    expect(screen.getByText('Subscription box')).toBeInTheDocument()
    expect(screen.getByText('Mobile app')).toBeInTheDocument()
    expect(screen.getByText('Social media')).toBeInTheDocument()
  })

  it('renders idea descriptions', () => {
    render(<BrainstormClusters clusters={clusters} />)
    expect(screen.getByText('Curated monthly delivery targeting hobbyists')).toBeInTheDocument()
    expect(screen.getByText('Instagram campaigns targeting Gen Z')).toBeInTheDocument()
  })

  it('renders nothing for empty clusters array', () => {
    const { container } = render(<BrainstormClusters clusters={[]} />)
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
